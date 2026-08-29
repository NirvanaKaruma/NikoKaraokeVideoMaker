import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'
import type { FfmpegConfig, MergeProgress, MergeRequest } from '../shared/ffmpeg'
import { getConfig, setConfig } from './config'
import { buildAudioFilter } from '../shared/ffmpeg'
import {
  cancelDownload,
  detectFfmpegStatus,
  getFFmpegPath,
  installManagedFfmpeg,
  invalidateFfmpegStatus,
  probeMediaDurationSec,
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

/** 解码会话：token → 子进程（按 token 取消；新请求 kill 旧请求） */
const audioDecodeSessions = new Map<string, { proc: import('child_process').ChildProcess }>()
/** 单块 PCM 字节数：4MB 分块 → 渲染进程每次只 ~20ms 反序列化，块间让出事件循环（UI 有响应窗口） */
const PCM_CHUNK_BYTES = 4 * 1024 * 1024

/**
 * 流式音频解码（预览用）：ffmpeg 子进程解码 stdout 边收边按 4MB 分块推送。
 * 不再全量 concat 驻留（省 main 侧 2×PCM 内存）；渲染进程零解码 CPU；
 * 新请求 kill 旧请求（重复导入不叠加内存）。
 */
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
  // 新请求 kill 旧请求
  for (const [tok, s] of audioDecodeSessions) {
    s.proc.kill()
    audioDecodeSessions.delete(tok)
  }
  const proc = spawn(
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
  audioDecodeSessions.set(token, { proc })
  const sendChunk = (part: Buffer): void => {
    if (sender.isDestroyed()) return
    sender.send('audio:pcm', {
      token,
      type: 'chunk',
      data: part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength)
    })
  }
  let errTail = ''
  let totalBytes = 0
  let exitCode: number | null = null
  let finished = false
  /**
   * 背压修复（60min 验收实测：主进程 OOM Buffer.concat）：
   * 原实现每 64KB data 事件做一次 Buffer.concat([pending, d]) 且无 socket 背压——
   * 渲染进程消费慢时 4MB 消息在 main 内排队至 GB 级；1.27GB(2ch f32) 流叠加 concat 拷贝 → 主进程 OOM。
   * 修复：① 池化批拼接（每 4MB 才 concat 一次）；② stdout.pause() 真背压（池超 2×块暂停，
   * ffmpeg 阻塞在着 OS 管道，消费追上再 resume）——main 侧常驻上限 ≈ 8MB。
   */
  let pool: Buffer[] = []
  let poolLen = 0
  let sending = false
  /** 收尾：必须等所有在途泵完成（否则在途块晚于 end 到达 → worker 截断，曾致音频 60s→24.9s） */
  const finish = async (): Promise<void> => {
    if (finished) return
    while (sending) await new Promise((r) => setImmediate(r))
    if (finished) return
    finished = true
    audioDecodeSessions.delete(token)
    if (poolLen > 0) {
      totalBytes += poolLen
      sendChunk(Buffer.concat(pool))
      pool = []
      poolLen = 0
    }
    if (exitCode === 0 && totalBytes > 0) {
      sender.send('audio:pcm', { token, type: 'end', sampleRate: 44100, channels: 2 })
    } else {
      sender.send('audio:pcm', { token, type: 'error', error: errTail || 'decode-failed' })
    }
  }
  const pump = async (): Promise<void> => {
    if (sending || finished) return
    sending = true
    try {
      while (!finished && poolLen >= PCM_CHUNK_BYTES) {
        proc.stdout.pause()
        const joined = poolLen === PCM_CHUNK_BYTES ? pool[0] : Buffer.concat(pool)
        pool = []
        poolLen = 0
        let off = 0
        while (off < joined.length) {
          const part = joined.subarray(off, off + PCM_CHUNK_BYTES)
          off += part.byteLength
          totalBytes += part.byteLength
          sendChunk(part)
          await new Promise((r) => setImmediate(r))
        }
      }
    } finally {
      if (!finished && poolLen < PCM_CHUNK_BYTES) proc.stdout.resume()
      sending = false
    }
  }
  proc.stdout.on('data', (d: Buffer) => {
    pool.push(d)
    poolLen += d.length
    // 未到 4MB 上限前保持流动；pump 内部对 ffmpeg 施加 pause/resume（超过阈值的真背压）
    if (poolLen >= PCM_CHUNK_BYTES) void pump()
  })
  proc.stderr.on('data', (d: Buffer) => {
    errTail = String(d).slice(-500)
  })
  proc.on('error', () => {
    exitCode = 1
    void finish()
  })
  proc.on('close', (code) => {
    exitCode = code ?? 1
    void finish()
  })
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
  // 手动检测 = 强制重检（绕过缓存）
  ipcMain.handle(IPC.ffmpegDetect, () => detectFfmpegStatus(true))

  ipcMain.handle(IPC.ffmpegConfigGet, async () => (await getConfig()).ffmpeg)

  ipcMain.handle(IPC.ffmpegConfigSet, async (_e, patch: Partial<FfmpegConfig>) => {
    const cfg = await setConfig({ ffmpeg: patch })
    invalidateFfmpegStatus()
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
      invalidateFfmpegStatus()
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

  ipcMain.handle('audio:decode-cancel', (_e, token: string) => {
    const tok = String(token)
    const s = audioDecodeSessions.get(tok)
    if (s) {
      s.proc.kill()
      audioDecodeSessions.delete(tok)
    }
    return true
  })

  // 0.7.0 超长音频护栏：导入前探测容器头时长（不解码；ffmpeg 不可用/解析失败 → null 由调用方走原路径）
  ipcMain.handle(IPC.audioProbeDuration, async (_e, path: string): Promise<number | null> => {
    if (typeof path !== 'string' || !path) return null
    try {
      const ffmpegPath = await getFFmpegPath()
      if (!ffmpegPath) return null
      return await probeMediaDurationSec(ffmpegPath, path)
    } catch {
      return null
    }
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
    // 0.7.0 音频工程：淡入淡出（歌曲本体）→ 前导 adelay+apad；全 0 时不追加 -af（与 0.6.5 一致）
    const audioFilter = req.audioEngine
      ? buildAudioFilter(
          req.audioEngine.leadMs,
          req.audioEngine.fadeInSec,
          req.audioEngine.fadeOutSec,
          req.durationMs / 1000
        )
      : ''
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
      ...(audioFilter ? ['-af', audioFilter] : []),
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
