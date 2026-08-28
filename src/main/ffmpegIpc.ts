import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'
import type { FfmpegConfig, MergeProgress, MergeRequest } from '../shared/ffmpeg'
import { getConfig, setConfig } from './config'
import {
  cancelDownload,
  detectFfmpegStatus,
  getFFmpegPath,
  installManagedFfmpeg,
  runFfmpeg,
  validateFfmpeg
} from './ffmpeg'

interface DownloadRequest {
  token: string
  url?: string
}

interface MergeInvoke extends MergeRequest {
  mergeId: string
}

/** 合并任务句柄（按 mergeId 取消） */
const mergeHandles = new Map<string, { kill: () => void }>()

let audioDecodeProc: import('child_process').ChildProcess | null = null
/** 单块 PCM 字节数：4MB 分块 → 渲染进程每次只 ~20ms 反序列化，块间让出事件循环（UI 有响应窗口） */
const PCM_CHUNK_BYTES = 4 * 1024 * 1024

/** 流式音频解码（预览用）：ffmpeg 子进程解码 → main 按 4MB 分块推送给渲染进程。
 * 渲染进程零解码 CPU、零长阻塞；新请求 kill 旧请求（重复导入不叠加内存）。 */
async function streamAudioDecode(
  sender: Electron.WebContents,
  token: string,
  path: string
): Promise<void> {
  const ff = await getFFmpegPath()
  if (!ff) {
    sender.send('audio:pcm', { token, type: 'error', error: 'no-ffmpeg' })
    return
  }
  audioDecodeProc?.kill()
  const chunks: Buffer[] = []
  let errTail = ''
  const ok = await new Promise<boolean>((resolve) => {
    const p = spawn(
      ff,
      [
        '-hide_banner',
        '-nostdin',
        '-i',
        path,
        '-vn',
        '-f',
        'f32le',
        '-acodec',
        'pcm_f32le',
        '-ar',
        '44100',
        '-ac',
        '2',
        'pipe:1'
      ],
      { windowsHide: true }
    )
    audioDecodeProc = p
    p.stdout.on('data', (d: Buffer) => chunks.push(d))
    p.stderr.on('data', (d: Buffer) => {
      errTail = String(d).slice(-500)
    })
    p.on('error', () => resolve(false))
    p.on('close', (code) => resolve(code === 0))
  })
  if (audioDecodeProc) audioDecodeProc = null
  if (!ok || chunks.length === 0) {
    sender.send('audio:pcm', { token, type: 'error', error: errTail || 'decode-failed' })
    return
  }
  const buf = Buffer.concat(chunks)
  for (let off = 0; off < buf.length; off += PCM_CHUNK_BYTES) {
    const end = Math.min(off + PCM_CHUNK_BYTES, buf.length)
    const part = buf.subarray(off, end)
    sender.send('audio:pcm', {
      token,
      type: 'chunk',
      data: part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)
    })
    // 块间让出事件循环：渲染进程可在反序列化间隙响应 UI（有窗口，不冻结）
    await new Promise((r) => setImmediate(r))
  }
  sender.send('audio:pcm', { token, type: 'end', sampleRate: 44100, channels: 2 })
}

/** 流式解码开始（invoke）：返回 token；结果经 'audio:pcm' 事件推给该 sender */
async function startAudioDecodeStream(
  e: Electron.IpcMainInvokeEvent,
  path: string
): Promise<string> {
  const token = e.sender.id + '-' + Date.now()
  void streamAudioDecode(e.sender, token, path)
  return token
}

/** 注册 ffmpeg 三源管理 + 导出合并的全部 IPC（规格 §3.4/§3.3） */
export function registerFfmpegIpc(): void {
  ipcMain.handle(IPC.ffmpegDetect, () => detectFfmpegStatus())

  ipcMain.handle(IPC.ffmpegConfigGet, async () => (await getConfig()).ffmpeg)

  ipcMain.handle(IPC.ffmpegConfigSet, async (_e, patch: Partial<FfmpegConfig>) => {
    const cfg = await setConfig({ ffmpeg: patch })
    return cfg.ffmpeg
  })

  ipcMain.handle(IPC.ffmpegValidate, (_e, path: string) => validateFfmpeg(path))

  ipcMain.handle(IPC.ffmpegPickCustom, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts: Electron.OpenDialogOptions = {
      title: t('dialogs.pickFfmpeg'),
      properties: ['openFile'],
      filters: [{ name: t('dialogs.ffmpegExeFilter'), extensions: ['exe'] }]
    }
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return res.canceled ? null : (res.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.ffmpegDownload, async (e, req: DownloadRequest) => {
    const sender = e.sender
    try {
      const info = await installManagedFfmpeg({
        token: req.token,
        url: req.url || undefined,
        onProgress: (p) => {
          if (!sender.isDestroyed()) sender.send(IPC.ffmpegDownloadProgress, p)
        }
      })
      return { ok: true, info }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  ipcMain.handle(IPC.ffmpegDownloadCancel, (_e, token: string) => {
    cancelDownload(token)
    return true
  })

  ipcMain.handle('audio:decode-start', async (e, path: string) => {
    if (typeof path !== 'string' || !path) return 'bad-path'
    return startAudioDecodeStream(e, path)
  })

  ipcMain.handle(IPC.exportPickOutput, async (e, defaultName: string) => {
    // 无头导出自测：直接落到 TEST-ARTIFACTS
    if (
      process.argv.some((a) => a.startsWith('--smoke-export')) ||
      (process.env['NIKO_SMOKE'] ?? '').startsWith('export:')
    ) {
      const dir = join(process.env['NIKO_SMOKE_DIR'] ?? process.cwd(), 'TEST-ARTIFACTS')
      await fs.mkdir(dir, { recursive: true })
      return join(dir, (defaultName || 'smoke') + '.mp4')
    }
    const win = BrowserWindow.fromWebContents(e.sender)
    const opts = {
      title: t('dialogs.exportVideo'),
      defaultPath: (defaultName || '未命名歌曲') + '.mp4',
      filters: [{ name: t('dialogs.mp4Filter'), extensions: ['mp4'] }]
    }
    const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    return res.canceled ? null : (res.filePath ?? null)
  })

  ipcMain.handle(IPC.exportSaveVideo, async (_e, buffer: ArrayBuffer, name: string) => {
    const dir = join(app.getPath('temp'), 'niko-export')
    await fs.mkdir(dir, { recursive: true })
    const path = join(dir, name)
    await fs.writeFile(path, Buffer.from(buffer))
    return path
  })

  ipcMain.handle(IPC.exportSaveAudio, async (_e, buffer: ArrayBuffer, name: string) => {
    const dir = join(app.getPath('temp'), 'niko-export')
    await fs.mkdir(dir, { recursive: true })
    const path = join(dir, name)
    await fs.writeFile(path, Buffer.from(buffer))
    return path
  })

  ipcMain.handle(IPC.exportMerge, async (e, req: MergeInvoke) => {
    const sender = e.sender
    const ffmpegPath = await getFFmpegPath()
    if (!ffmpegPath) {
      return { ok: false, error: t('ffmpeg.noAvailable') }
    }
    // 兜底：输出文件 = 音频源文件 → ffmpeg 无法原地覆盖输入，直接给出可读错误
    const same = (a: string, b: string): boolean =>
      a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
      b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (same(req.outputPath, req.audioPath)) {
      return { ok: false, error: t('ffmpeg.mergeFailSameFile') }
    }
    const args = [
      '-y',
      '-i',
      req.videoPath,
      '-i',
      req.audioPath,
      '-map',
      '0:v:0',
      '-map',
      '1:a:0',
      '-c:v',
      'copy',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-shortest',
      '-movflags',
      '+faststart',
      '-progress',
      'pipe:1',
      '-nostats',
      req.outputPath
    ]
    const run = runFfmpeg(ffmpegPath, args, {
      onStdoutLine: (line) => {
        const m = /out_time_ms=(\d+)/.exec(line)
        if (m && req.durationMs > 0 && !sender.isDestroyed()) {
          const percent = Math.min(100, Math.round((Number(m[1]) / req.durationMs) * 100))
          const progress: MergeProgress = { percent, message: t('ffmpeg.mergeProgress') }
          sender.send(IPC.exportMergeProgress, progress)
        }
      }
    })
    mergeHandles.set(req.mergeId, run)
    try {
      const res = await run.promise
      mergeHandles.delete(req.mergeId)
      if (res.code !== 0) {
        const tail = (res.stderr || res.stdout).slice(-600)
        const stderr = res.stderr || ''
        const mapFfmpegError = (s: string): string => {
          if (/same as Input|cannot edit existing files in-place/.test(s)) {
            return t('ffmpeg.mergeFailSameFile')
          }
          if (/Permission denied|Access is denied/.test(s)) {
            return t('ffmpeg.mergeFailPermission')
          }
          if (/No space left on device/.test(s)) {
            return t('ffmpeg.mergeFailDisk')
          }
          if (/does not contain any stream|Stream map.*matches no streams/.test(s)) {
            return t('ffmpeg.mergeFailNoStream')
          }
          return ''
        }
        const hint = mapFfmpegError(stderr)
        return { ok: false, error: hint || t('ffmpeg.mergeFailGeneric', { tail }) }
      }
      return { ok: true }
    } finally {
      mergeHandles.delete(req.mergeId)
      // 清理临时纯视频文件
      await fs.rm(req.videoPath, { force: true }).catch(() => undefined)
    }
  })

  ipcMain.handle(IPC.exportMergeCancel, (_e, mergeId: string) => {
    const h = mergeHandles.get(mergeId)
    if (h) {
      h.kill()
      mergeHandles.delete(mergeId)
    }
    return true
  })
}
