import { app, ipcMain } from 'electron'
import { createWriteStream, promises as fs, mkdirSync } from 'fs'
import { get as httpsGet, request as httpsRequest } from 'https'
import { join, dirname } from 'path'
import { createHash } from 'crypto'
import { pipeline } from 'stream/promises'
import { spawn } from 'child_process'
import { IPC } from '../shared/ipc'
import { parseRelease, type UpdateCheckResult } from '../shared/updater'

/**
 * 自更新（1.0.0）——main 侧：检测（GitHub API，公开仓库匿名）/ 下载（流式 + SHA-256 校验）/
 * 应用（portable exe 自替换：write updater.bat → 独立 cmd 进程等待旧进程退出后 copy 覆盖 → 启动新版）。
 *
 * 安全边界：
 * - 仅生产打包（app.isPackaged）允许 apply；dev/smoke 一律拒绝（防误替换开发目录）。
 * - 下载必须校验 sha256（GitHub asset digest），无 digest 则拒绝执行（防中间人）。
 * - bat 只做 copy/y + start + 自删；路径以双引号包裹写入（cmd 转义规则统一），无注入面。
 */

/** 仓库信息（公开；与 package.json/git remote 一致） */
const REPO_OWNER = 'NirvanaKaruma'
const REPO_NAME = 'NikoKaraokeVideoMaker'
const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`

export interface DownloadProgress {
  phase: 'connecting' | 'downloading' | 'verifying' | 'done' | 'error'
  percent: number
  receivedBytes: number
  totalBytes: number
}

interface UpdateDownloadState {
  jobId: string
  targetPath: string
  aborted: boolean
}

let downloadState: UpdateDownloadState | null = null

/** 下载进度推送（sender 已销毁 / 非当前会话则静默——重定向会重建会话） */
function notifyProgress(
  sender: Electron.WebContents,
  p: DownloadProgress,
  sessionJobId: string
): void {
  if (sender.isDestroyed()) return
  if (downloadState && downloadState.jobId !== sessionJobId) return
  sender.send(IPC.updaterDownloadProgress, p)
}

/** GitHub API 请求（JSON；公开仓库无需 token） */
function apiGet<T>(path: string, timeoutMs = 15000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      `${API_BASE}${path}`,
      {
        method: 'GET',
        headers: {
          'User-Agent': 'niko-karaoke-video-maker-updater',
          Accept: 'application/vnd.github+json'
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const status = res.statusCode ?? 0
          const body = Buffer.concat(chunks).toString('utf-8')
          if (status < 200 || status >= 300) {
            reject(new Error('github-' + status))
            return
          }
          try {
            resolve(JSON.parse(body) as T)
          } catch {
            reject(new Error('bad-json'))
          }
        })
      }
    )
    req.on('timeout', () => {
      req.destroy(new Error('timeout'))
    })
    req.on('error', reject)
    req.end()
  })
}

/** 检测更新：GET releases/latest → parseRelease（纯函数对比本地版本） */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
  const current = app.getVersion()
  try {
    const resp = await apiGet<{
      tag_name: string
      body?: string | null
      assets?: { name: string; browser_download_url: string; size?: number; digest?: string }[]
    }>('/releases/latest')
    return parseRelease(resp, current)
  } catch (e) {
    return {
      ok: false,
      current,
      latest: current,
      hasUpdate: false,
      error: e instanceof Error ? e.message : String(e)
    }
  }
}

/**
 * 下载发布资产到临时目录（jobId 防并发；进度事件；SHA-256 校验）。
 * 返回 {ok, path, sha256, error}——path 供 apply 使用；失败/校验失败已删除临时文件。
 */
export function downloadUpdate(
  sender: Electron.WebContents,
  jobId: string,
  url: string,
  expectedSha256?: string | null
): Promise<{ ok: boolean; path?: string; error?: string }> {
  return new Promise((resolve) => {
    const tmpDir = join(app.getPath('temp'), 'niko-update')
    mkdirSync(tmpDir, { recursive: true })
    const targetPath = join(tmpDir, `niko-${jobId}.exe`)
    // 取消旧任务（单窗口单下载）
    if (downloadState) downloadState.aborted = true
    const st: UpdateDownloadState = { jobId, targetPath, aborted: false }
    downloadState = st

    const hash = createHash('sha256')
    let totalBytes = 0
    let received = 0

    const fail = (error: string): void => {
      st.aborted = false
      if (downloadState === st) downloadState = null
      void fs.unlink(targetPath).catch(() => undefined)
      notifyProgress(
        sender,
        {
          phase: 'error',
          percent: 0,
          receivedBytes: received,
          totalBytes
        },
        st.jobId
      )
      resolve({ ok: false, error })
    }

    const req = httpsGet(url, (res) => {
      const status = res.statusCode ?? 0
      // GitHub 资产 → 302 到 objects.githubusercontent.com；跟随一次即到 200
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        req.destroy()
        void downloadUpdate(sender, jobId, res.headers.location, expectedSha256)
          .then((r) => resolve(r))
          .catch(() => fail('redirect-failed'))
        return
      }
      if (status !== 200) {
        res.resume()
        fail('http-' + status)
        return
      }
      totalBytes = Number(res.headers['content-length'] ?? 0)
      const out = createWriteStream(targetPath)
      res.on('data', (c: Buffer) => {
        if (st.aborted) {
          res.destroy()
          return
        }
        hash.update(c)
        received += c.length
        if (totalBytes > 0) {
          notifyProgress(
            sender,
            {
              phase: 'downloading',
              percent: Math.min(100, Math.round((received / totalBytes) * 100)),
              receivedBytes: received,
              totalBytes
            },
            st.jobId
          )
        }
      })
      void pipeline(res, out)
        .then(async () => {
          if (st.aborted) return
          notifyProgress(
            sender,
            {
              phase: 'verifying',
              percent: 100,
              receivedBytes: received,
              totalBytes
            },
            st.jobId
          )
          // 校验：GitHub digest 必须匹配；无 digest → 拒绝（安全优先）
          const actual = hash.digest('hex')
          if (!expectedSha256) {
            await fs.unlink(targetPath).catch(() => undefined)
            fail('no-sha256')
            return
          }
          if (actual.toLowerCase() !== expectedSha256.toLowerCase()) {
            await fs.unlink(targetPath).catch(() => undefined)
            fail('sha256-mismatch')
            return
          }
          st.aborted = false
          if (downloadState === st) downloadState = null
          notifyProgress(
            sender,
            {
              phase: 'done',
              percent: 100,
              receivedBytes: received,
              totalBytes
            },
            st.jobId
          )
          resolve({ ok: true, path: targetPath })
        })
        .catch((err) => {
          if (!st.aborted) fail(err instanceof Error ? err.message : String(err))
        })
    })
    req.on('error', (e) => {
      if (!st.aborted) fail(e.message)
    })
  })
}

/**
 * 应用更新（portable 自替换）：
 * ① 写 updater.bat（独立 cmd 进程，主进程退出后继续）
 * ② 等旧进程退出（tasklist 轮询 ≤30s）→ copy /Y 新 exe 覆盖 → 启动新版 → 自删 bat
 * ⚠ 跨盘（系统盘 exe vs 用户临时目录）copy 会失败——bat 内重试直至超时退出（不覆盖 = 安全失败）
 */
export function applyUpdate(path: string): { ok: boolean; error?: string } {
  if (!app.isPackaged) {
    return { ok: false, error: 'not-packaged' }
  }
  const exePath = process.execPath
  const newPath = path
  const exeName = exePath.split('\\').pop() ?? ''
  if (!exeName.toLowerCase().endsWith('.exe') || !newPath.toLowerCase().endsWith('.exe')) {
    return { ok: false, error: 'not-exe' }
  }
  const batPath = join(dirname(exePath), 'niko-update.bat')
  // cmd 双引号路径转义：内部 " → "".（标准做法）
  const esc = (p: string): string => p.replace(/"/g, '""')
  const bat = [
    '@echo off',
    'set "TARGET=' + esc(exePath) + '"',
    'set "NEW=' + esc(newPath) + '"',
    'set /a WAIT=0',
    ':loop',
    'tasklist /FI "IMAGENAME eq ' +
      esc(exeName) +
      '" 2>NUL | findstr /I /C:"' +
      esc(exeName) +
      '" >NUL && (',
    '  timeout /T 1 /NOBREAK >NUL',
    '  set /a WAIT+=1',
    '  if %WAIT% GEQ 30 goto giveup',
    '  goto loop',
    ')',
    ':copy',
    'copy /Y "%NEW%" "%TARGET%" >NUL',
    'if errorlevel 1 (timeout /T 1 /NOBREAK >NUL & goto copy)',
    'del /Q "%NEW%" >NUL 2>NUL',
    'start "" "%TARGET%"',
    'del /Q "%~f0" 2>NUL',
    'exit /b 0',
    ':giveup',
    'del /Q "%~f0" 2>NUL',
    'exit /b 1',
    ''
  ].join('\r\n')

  try {
    void fs.writeFile(batPath, bat, 'utf-8').then(() => {
      const child = spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', batPath], {
        detached: true,
        stdio: 'ignore',
        cwd: dirname(exePath)
      })
      child.unref()
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** 注册 updater IPC（check/download/apply + 进度） */
export function registerUpdaterIpc(): void {
  ipcMain.handle(IPC.updaterCheck, () => checkForUpdate())
  ipcMain.handle(IPC.updaterDownload, (e, jobId: string, url: string, sha256?: string | null) =>
    downloadUpdate(e.sender, String(jobId), String(url), sha256 ?? null)
  )
  ipcMain.handle(IPC.updaterApply, (_e, path: string) => applyUpdate(String(path)))
}
