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

/** 音频解码请求：任何 ffmpeg 可读的媒体（mp3/flac/wav/m4a/mp4…）→ 44.1kHz 立体声 f32 交错 PCM */
interface AudioDecodeResult {
  ok: boolean
  samples: ArrayBuffer | null
  sampleRate: number
  channels: number
  error: string | null
}

let audioDecodeProc: import('child_process').ChildProcess | null = null

/** 音频解码（预览用）：ffmpeg 子进程解码到内存——渲染进程完全不参与解码（UI 永不卡）。
 * 新请求会终止进行中的旧请求（重复导入不再叠加内存）。 */
async function handleAudioDecode(path: string): Promise<AudioDecodeResult> {
  const ff = await getFFmpegPath()
  if (!ff) return { ok: false, samples: null, sampleRate: 0, channels: 0, error: 'no-ffmpeg' }
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
    return {
      ok: false,
      samples: null,
      sampleRate: 0,
      channels: 0,
      error: errTail || 'decode-failed'
    }
  }
  const buf = Buffer.concat(chunks)
  const samples = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  return { ok: true, samples, sampleRate: 44100, channels: 2, error: null }
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

  ipcMain.handle('audio:decode', async (_e, path: string) => {
    if (typeof path !== 'string' || !path) {
      return { ok: false, samples: null, sampleRate: 0, channels: 0, error: 'bad-path' }
    }
    return handleAudioDecode(path)
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
