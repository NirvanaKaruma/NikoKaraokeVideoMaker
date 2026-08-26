import { spawn } from 'child_process'
import { createWriteStream, promises as fs, existsSync } from 'fs'
import { get } from 'https'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { app } from 'electron'
import { open } from 'yauzl'
import type {
  DownloadProgress,
  EffectiveFfmpeg,
  FfmpegDetectInfo,
  FfmpegSource,
  FfmpegStatusReport
} from '../shared/ffmpeg'
import { DEFAULT_FFMPEG_DOWNLOAD_URL } from '../shared/ffmpeg'
import { getConfig, managedFfmpegDir, managedFfmpegPath } from './config'

export interface FfmpegRunResult {
  code: number | null
  stdout: string
  stderr: string
}

export interface FfmpegRunHandle {
  promise: Promise<FfmpegRunResult>
  kill: () => void
}

/** 统一 ffmpeg 调用入口（规格 §3.4：所有调用都走这里，禁止别处硬编码路径） */
export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  opts: { onStdoutLine?: (line: string) => void } = {}
): FfmpegRunHandle {
  const child = spawn(ffmpegPath, args, { windowsHide: true })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString()
    if (opts.onStdoutLine) {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) opts.onStdoutLine(line)
      }
    }
  })
  child.stderr.on('data', (chunk: Buffer) => {
    const text = chunk.toString()
    stderr += text
    // ffmpeg 把信息日志写在 stderr；版本/编码器信息也从这里取
    if (opts.onStdoutLine) {
      for (const line of text.split(/\r?\n/)) {
        if (line.trim()) opts.onStdoutLine(line)
      }
    }
  })
  const promise = new Promise<FfmpegRunResult>((resolve) => {
    child.on('error', (err) => {
      resolve({ code: null, stdout, stderr: stderr + String(err) })
    })
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
  return { promise, kill: () => child.kill() }
}

/** 运行并校验：返回版本 + aac（必须）/libx264（可选） */
export async function validateFfmpeg(ffmpegPath: string): Promise<FfmpegDetectInfo> {
  const versionRun = runFfmpeg(ffmpegPath, ['-version'])
  const versionRes = await versionRun.promise
  if (versionRes.code !== 0) {
    return {
      status: 'error',
      path: ffmpegPath,
      version: '',
      hasAac: false,
      hasLibx264: false,
      error: '无法执行（-version 失败）：' + (versionRes.stderr || versionRes.stdout).slice(0, 300)
    }
  }
  const versionMatch = /ffmpeg version (\S+)/.exec(versionRes.stdout + versionRes.stderr)
  const version = versionMatch?.[1] ?? '未知'

  const encRun = runFfmpeg(ffmpegPath, ['-hide_banner', '-encoders'])
  const encRes = await encRun.promise
  const encoders = encRes.stdout + encRes.stderr
  const hasAac = /(^|\s)aac\s/.test(encoders)
  const hasLibx264 = /(^|\s)libx264\s/.test(encoders)

  return {
    status: hasAac ? 'ok' : 'error',
    path: ffmpegPath,
    version,
    hasAac,
    hasLibx264,
    error: hasAac ? undefined : '缺少 aac 编码器，无法用于导出'
  }
}

/** 检测系统 PATH 中的 ffmpeg */
export async function detectSystemFfmpeg(): Promise<FfmpegDetectInfo | null> {
  const probe = runFfmpeg('ffmpeg', ['-version'])
  const res = await probe.promise
  if (res.code !== 0) return null
  return validateFfmpeg('ffmpeg')
}

/** 检测托管版（userData/ffmpeg/ffmpeg.exe） */
export async function detectManagedFfmpeg(): Promise<FfmpegDetectInfo | null> {
  const path = managedFfmpegPath()
  if (!existsSync(path)) return null
  return validateFfmpeg(path)
}

/** 检测用户手动指定的路径 */
export async function detectCustomFfmpeg(customPath: string): Promise<FfmpegDetectInfo | null> {
  if (!customPath || !existsSync(customPath)) return null
  return validateFfmpeg(customPath)
}

/** 三源状态汇总 + 当前生效来源（按用户选择，选中的不可用则回退到其他可用源） */
export async function detectFfmpegStatus(): Promise<FfmpegStatusReport> {
  const config = await getConfig()
  const system = await detectSystemFfmpeg()
  const managed = await detectManagedFfmpeg()
  const custom = await detectCustomFfmpeg(config.ffmpeg.customPath)

  const pool: { source: FfmpegSource; info: FfmpegDetectInfo | null }[] = [
    { source: 'system', info: system },
    { source: 'managed', info: managed },
    { source: 'custom', info: custom }
  ]
  const bySource = (s: FfmpegSource): { source: FfmpegSource; info: FfmpegDetectInfo | null } =>
    pool.find((p) => p.source === s) ?? { source: s, info: null }

  const preferred = bySource(config.ffmpeg.source)
  const chosen =
    preferred.info && preferred.info.status === 'ok'
      ? preferred
      : (pool.find((p) => p.info && p.info.status === 'ok') ?? null)

  const effective: EffectiveFfmpeg = chosen?.info
    ? {
        available: true,
        source: chosen.source,
        path: chosen.info.path,
        info: chosen.info
      }
    : { available: false, source: null, path: null, info: null }

  return { system, managed, custom, effective, config: config.ffmpeg }
}

/** 生效的 ffmpeg 路径（导出等使用） */
export async function getFFmpegPath(): Promise<string | null> {
  const status = await detectFfmpegStatus()
  return status.effective.available ? status.effective.path : null
}

/* ---------------- 托管版下载安装（T17） ---------------- */

interface ActiveDownload {
  aborted: boolean
}

const activeDownloads = new Map<string, ActiveDownload>()

export function cancelDownload(token: string): void {
  const d = activeDownloads.get(token)
  if (d) d.aborted = true
}

function downloadFile(
  url: string,
  dest: string,
  onProgress: (percent: number) => void,
  isAborted: () => boolean
): Promise<void> {
  // 本地镜像（file://）：直接复制（离线测试 / 内网分发场景）
  if (url.startsWith('file://')) {
    return (async () => {
      const src = fileURLToPath(url)
      onProgress(10)
      await fs.copyFile(src, dest)
      onProgress(100)
    })()
  }
  return new Promise((resolve, reject) => {
    const follow = (u: string, redirects: number): void => {
      if (redirects > 5) {
        reject(new Error('重定向次数过多'))
        return
      }
      const req = get(u, { headers: { 'User-Agent': 'NikoKaraokeVideoMaker/1.0' } }, (res) => {
        const status = res.statusCode ?? 0
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume()
          follow(new URL(res.headers.location, u).toString(), redirects + 1)
          return
        }
        if (status !== 200) {
          res.resume()
          reject(new Error('下载失败：HTTP ' + status))
          return
        }
        const total = Number(res.headers['content-length'] ?? 0)
        let received = 0
        const file = createWriteStream(dest)
        res.on('data', (chunk: Buffer) => {
          received += chunk.length
          if (isAborted()) {
            req.destroy()
            file.close()
            return
          }
          if (total > 0) onProgress(Math.min(100, Math.round((received / total) * 100)))
        })
        res.pipe(file)
        file.on('finish', () => file.close(() => resolve()))
        res.on('error', reject)
        file.on('error', reject)
      })
      req.on('error', reject)
    }
    follow(url, 0)
  })
}

/** 从 zip 中只解压 ffmpeg.exe（gyan 包内为 bin/ffmpeg.exe）到目标目录 */
async function extractFfmpegExe(zipPath: string, destDir: string): Promise<string> {
  return new Promise((resolve, reject) => {
    open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('打开压缩包失败'))
        return
      }
      let found = false
      zipfile.readEntry()
      zipfile.on('entry', (entry) => {
        if (found) {
          zipfile.readEntry()
          return
        }
        const name = entry.fileName.replace(/\\/g, '/')
        const isExe =
          name.toLowerCase().endsWith('ffmpeg.exe') && !name.toLowerCase().includes('ffprobe')
        if (!isExe) {
          zipfile.readEntry()
          return
        }
        found = true
        zipfile.openReadStream(entry, (err2, stream) => {
          if (err2 || !stream) {
            reject(err2 ?? new Error('读取压缩包条目失败'))
            return
          }
          const out = join(destDir, 'ffmpeg.exe')
          const ws = createWriteStream(out)
          stream.pipe(ws)
          ws.on('finish', () => {
            ws.close()
            zipfile.close()
            resolve(out)
          })
          stream.on('error', reject)
          ws.on('error', reject)
        })
      })
      zipfile.on('end', () => {
        if (!found) reject(new Error('压缩包中未找到 ffmpeg.exe'))
      })
      zipfile.on('error', reject)
    })
  })
}

/**
 * 一键下载安装托管版（T17）：
 * 下载（可取消/进度）→ 解压出 ffmpeg.exe 到 userData/ffmpeg/ → 校验（aac）。
 * 进度通过 onProgress 回调上报；完成后校验结果经 onValidated 返回。
 */
export async function installManagedFfmpeg(opts: {
  token: string
  url?: string
  onProgress: (p: DownloadProgress) => void
}): Promise<FfmpegDetectInfo> {
  const config = await getConfig()
  const url = opts.url || config.ffmpeg.downloadUrl || DEFAULT_FFMPEG_DOWNLOAD_URL
  const dir = managedFfmpegDir()
  await fs.mkdir(dir, { recursive: true })
  const zipPath = join(app.getPath('temp'), 'niko-ffmpeg-' + opts.token + '.zip')

  const active: ActiveDownload = { aborted: false }
  activeDownloads.set(opts.token, active)

  try {
    opts.onProgress({ phase: 'downloading', percent: 0, message: '正在下载 ffmpeg…' })
    await downloadFile(
      url,
      zipPath,
      (p) => {
        opts.onProgress({ phase: 'downloading', percent: p, message: '正在下载 ffmpeg…' })
      },
      () => active.aborted
    )
    if (active.aborted) throw new Error('下载已取消')

    opts.onProgress({ phase: 'extracting', percent: null, message: '正在解压 ffmpeg.exe…' })
    await extractFfmpegExe(zipPath, dir)
    if (active.aborted) throw new Error('下载已取消')

    opts.onProgress({ phase: 'validating', percent: null, message: '正在校验编码器…' })
    const info = await validateFfmpeg(managedFfmpegPath())
    if (info.status !== 'ok') throw new Error(info.error ?? '校验失败')
    opts.onProgress({ phase: 'done', percent: 100, message: '安装完成：ffmpeg ' + info.version })
    return info
  } finally {
    activeDownloads.delete(opts.token)
    await fs.rm(zipPath, { force: true }).catch(() => undefined)
  }
}
