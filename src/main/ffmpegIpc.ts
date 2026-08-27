import { BrowserWindow, app, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'
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
      title: '选择 ffmpeg.exe',
      properties: ['openFile'],
      filters: [{ name: 'ffmpeg 可执行文件', extensions: ['exe'] }]
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
      title: '导出视频',
      defaultPath: (defaultName || '未命名歌曲') + '.mp4',
      filters: [{ name: 'MP4 视频', extensions: ['mp4'] }]
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
      return { ok: false, error: '没有可用的 ffmpeg：请到设置页一键下载托管版或手动指定路径' }
    }
    // 兜底：输出文件 = 音频源文件 → ffmpeg 无法原地覆盖输入，直接给出可读错误
    const same = (a: string, b: string): boolean =>
      a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
      b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
    if (same(req.outputPath, req.audioPath)) {
      return {
        ok: false,
        error: '输出文件与音频源文件是同一个文件，请更换文件名或保存位置后重试。'
      }
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
          const progress: MergeProgress = { percent, message: '正在合并音视频…' }
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
            return '输出文件与音频源文件是同一个文件，请更换文件名或保存位置后重试。'
          }
          if (/Permission denied|Access is denied/.test(s)) {
            return '没有权限写入所选位置（文件可能被其他程序占用或受保护），请换个保存位置后重试。'
          }
          if (/No space left on device/.test(s)) {
            return '磁盘空间不足，请清理空间后重试。'
          }
          if (/does not contain any stream|Stream map.*matches no streams/.test(s)) {
            return '音频文件没有可用的音轨，请换一个音频文件。'
          }
          return ''
        }
        const hint = mapFfmpegError(stderr)
        return { ok: false, error: hint || 'ffmpeg 合并失败：' + tail }
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
