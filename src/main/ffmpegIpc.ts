import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream } from 'fs'
import { promises as fs } from 'fs'
import { pipeline } from 'stream/promises'
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

/** 解码会话：token → 临时 PCM 文件（P0 重构后无子进程流控；dispose 清理） */
interface AudioDecodeSession {
  proc: import('child_process').ChildProcess | null
  tmpPath: string
  fh: import('fs/promises').FileHandle | null
  size: number
  sampleRate: number
  channels: number
  cancelled: boolean
  /** spawn 时同步注册的 'close' 承诺（dispose 等它——在途退出也无 TOCTOU 丢失） */
  closedP: Promise<number | null> | null
}
const audioDecodeSessions = new Map<string, AudioDecodeSession>()
/** 单块 PCM 字节数：4MB 分块拉取（渲染侧 transfer 进 Worker，块间让出事件循环） */
const PCM_CHUNK_BYTES = 4 * 1024 * 1024

const pcmTempPath = (token: string): string =>
  join(app.getPath('temp'), 'niko-audio-' + token + '.pcmf32le')

/**
 * P0 结构重构：ffmpeg f32le stdout → 临时 PCM 文件（Node pipeline 文档化背压——删除全部手写
 * 池化/pause/resume 流控，截断与块边界卡顿由构造消灭）。start 异步等待解码完成（IPC invoke 等待，
 * 渲染侧 UI 不受影响；60min ≈ 1.27GB 落盘、读毕即删）。新请求 kill 旧请求（重复导入不叠加）。
 */
async function startAudioDecode(
  sender: Electron.IpcMainInvokeEvent,
  path: string
): Promise<{
  ok: boolean
  token?: string
  path?: string
  sampleRate?: number
  channels?: number
  error?: string
}> {
  const ff = await getFFmpegPath()
  if (!ff) return { ok: false, error: 'no-ffmpeg' }
  // 新请求 kill 旧请求
  for (const [tok, s] of audioDecodeSessions) {
    if (s.proc) s.proc.kill()
    audioDecodeSessions.delete(tok)
  }
  const token = sender.sender.id + '-' + Date.now()
  const tmpPath = pcmTempPath(token)
  const session: AudioDecodeSession = {
    proc: null,
    tmpPath,
    fh: null,
    size: 0,
    sampleRate: 44100,
    channels: 2,
    cancelled: false,
    closedP: null
  }
  audioDecodeSessions.set(token, session)
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
  session.proc = proc
  let errTail = ''
  proc.stderr.on('data', (d: Buffer) => {
    errTail = String(d).slice(-500)
  })
  const closeP = new Promise<number | null>((res) => {
    proc.on('close', res)
  })
  session.closedP = closeP
  try {
    await pipeline(proc.stdout, createWriteStream(tmpPath, { flags: 'w' }))
    const code = await closeP
    if (session.cancelled) {
      await fs.unlink(tmpPath).catch(() => undefined)
      audioDecodeSessions.delete(token)
      return { ok: false, error: 'cancelled' }
    }
    if (code !== 0) {
      await fs.unlink(tmpPath).catch(() => undefined)
      audioDecodeSessions.delete(token)
      return { ok: false, error: errTail || 'decode-failed' }
    }
    const st = await fs.stat(tmpPath)
    session.size = st.size
    return {
      ok: true,
      token,
      path: tmpPath,
      sampleRate: session.sampleRate,
      channels: session.channels
    }
  } catch (err) {
    session.cancelled = true
    await fs.unlink(tmpPath).catch(() => undefined)
    audioDecodeSessions.delete(token)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** 按偏移分块读取已解码 PCM（文件句柄会话内缓存；EOF 由 offset+bytesRead ≥ size 判定） */
async function readPcmChunk(
  token: string,
  offset: number,
  length: number
): Promise<{ ok: boolean; bytes?: ArrayBuffer; eof?: boolean; error?: string }> {
  const s = audioDecodeSessions.get(token)
  if (!s) return { ok: false, error: 'gone' }
  try {
    const fh = s.fh ?? (s.fh = await fs.open(s.tmpPath, 'r'))
    const want = Math.max(0, Math.min(PCM_CHUNK_BYTES, length, s.size - offset))
    if (want <= 0) return { ok: true, bytes: new ArrayBuffer(0), eof: true }
    const buf = Buffer.allocUnsafe(want)
    const { bytesRead } = await fh.read(buf, 0, want, offset)
    return {
      ok: true,
      bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + bytesRead),
      eof: offset + bytesRead >= s.size
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * 读毕/中断清理：关句柄、删临时文件、移除会话（幂等）。
 * ⚠ Windows：子进程未退出前写入流仍持有临时文件 → 必须先 kill 并 await 'close' 再 unlink，
 * 否则 unlink 静默失败留下孤儿文件（decode 中取消的必然路径）。
 */
async function disposeAudioDecode(token: string): Promise<void> {
  const s = audioDecodeSessions.get(token)
  if (!s) return
  s.cancelled = true
  if (s.proc && s.proc.exitCode === null) {
    s.proc.kill()
    if (s.closedP) await s.closedP.catch(() => null)
  }
  await s.fh?.close().catch(() => undefined)
  s.fh = null
  await fs.unlink(s.tmpPath).catch(() => undefined)
  audioDecodeSessions.delete(token)
}

/** 解码中断：kill 子进程（等退出）+ 删临时文件 + 清会话（渲染侧切换音频/新建项目时调用） */
async function cancelAudioDecode(token: string): Promise<void> {
  await disposeAudioDecode(token)
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

  ipcMain.handle(IPC.audioDecodeStart, async (e, path: string) => {
    if (typeof path !== 'string' || !path) return { ok: false, error: 'bad-path' }
    return startAudioDecode(e, path)
  })

  ipcMain.handle(IPC.audioDecodeRead, (_e, token: string, offset: number, length: number) =>
    readPcmChunk(String(token), Number(offset) || 0, Number(length) || PCM_CHUNK_BYTES)
  )

  ipcMain.handle(IPC.audioDecodeDispose, (_e, token: string) => disposeAudioDecode(String(token)))

  ipcMain.handle(IPC.audioDecodeCancel, (_e, token: string) => cancelAudioDecode(String(token)))

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
