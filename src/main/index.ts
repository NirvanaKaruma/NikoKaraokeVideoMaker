import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC } from '../shared/ipc'
import { registerFfmpegIpc } from './ffmpegIpc'
import { detectFfmpegStatus, detectManagedFfmpeg, installManagedFfmpeg } from './ffmpeg'

/** smoke 自测模式：加载渲染页后执行一次 ping 往返，结果写入 smoke-result.txt 并退出 */
const isSmokeTest = process.argv.includes('--smoke-test')
/** smoke-visual 模式：加载渲染页后截图舞台，写入 smoke-stage.png 并退出（M2 无头目视自测） */
const isSmokeVisual = process.argv.includes('--smoke-visual')
/** smoke-export 模式：无头端到端导出（--smoke-export=720p,1080p@35 / --smoke-export=4k@10） */
const smokeExportArg = process.argv.find((a) => a.startsWith('--smoke-export='))
const isSmokeExport = smokeExportArg !== undefined

/** smoke-bench：GPU 加速基准（硬件 vs 软件 30 帧实测）落盘 */
const isSmokeBench = process.argv.includes('--smoke-bench')
/** smoke-detect：只做三源检测并落盘（来源矩阵测试用，配合 PATH 操控） */
const isSmokeDetect = process.argv.includes('--smoke-detect')
/** smoke-download：走一遍托管安装（--smoke-download=default 或完整 URL / file:// 本地镜像） */
const smokeDownloadArg = process.argv.find((a) => a.startsWith('--smoke-download='))

function parseSmokeExport(): { resolutions: string[]; durationSec: number } {
  const body = (smokeExportArg ?? '').split('=')[1] ?? ''
  const [resPart, durPart] = body.split('@')
  return {
    resolutions: resPart ? resPart.split(',').filter(Boolean) : ['720p'],
    durationSec: durPart ? Number(durPart) : 35
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'NikoKaraokeVideoMaker',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 导出编码期间即使窗口最小化/隐藏也不节流定时器（否则编码速度骤降）
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isSmokeTest && !isSmokeVisual && !isSmokeExport && !isSmokeBench) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (isSmokeVisual || isSmokeBench) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeVisual: '1' } })
  } else if (isSmokeExport) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeExport: '1' } })
  } else if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerIpcHandlers(): void {
  // M1 hello：验证 renderer → main 往返链路
  ipcMain.handle(IPC.appPing, () => 'pong')
}

async function runSmokeVisual(win: BrowserWindow): Promise<void> {
  try {
    const dataUrl: unknown = await win.webContents.executeJavaScript('window.__captureStage()')
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
      await writeFile(
        join(process.cwd(), 'smoke-stage.png'),
        Buffer.from(dataUrl.split(',')[1], 'base64')
      )
      console.log('[smoke-visual] 舞台截图已保存 smoke-stage.png')
    } else {
      console.error('[smoke-visual] 未获取到截图数据')
      app.exit(1)
      return
    }
    const report: unknown = await win.webContents.executeJavaScript('window.__runVisualChecks()')
    const staticOk = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-visual] 像素校验:', staticOk ? '全部通过' : '存在失败项')

    // M3：音频链路校验（WAV File → 解码 → FFT → 频谱渲染动态变化）
    const audioReport: unknown = await win.webContents.executeJavaScript('window.__runAudioSmoke()')
    const audioOk = (audioReport as { ok?: boolean })?.ok === true
    console.log('[smoke-visual] 音频频谱校验:', audioOk ? '全部通过' : '存在失败项')

    await writeFile(
      join(process.cwd(), 'smoke-visual-report.json'),
      JSON.stringify({ static: report, audio: audioReport, ok: staticOk && audioOk }, null, 2),
      'utf-8'
    )
    app.exit(staticOk && audioOk ? 0 : 1)
  } catch (error) {
    console.error('[smoke-visual] 截图失败:', error)
    app.exit(1)
  }
}

async function runSmokeBench(win: BrowserWindow): Promise<void> {
  try {
    const report: unknown = await win.webContents.executeJavaScript('window.__runEncodeBenchmark()')
    await writeFile(
      join(process.cwd(), 'smoke-bench-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    console.log('[smoke-bench]', JSON.stringify(report, null, 2))
    app.exit(0)
  } catch (error) {
    console.error('[smoke-bench] 失败:', error)
    app.exit(1)
  }
}

async function runSmokeExport(win: BrowserWindow): Promise<void> {
  try {
    const { resolutions, durationSec } = parseSmokeExport()
    console.log('[smoke-export] 分辨率:', resolutions.join(','), '时长:', durationSec + 's')
    const report: unknown = await win.webContents.executeJavaScript(
      'window.__runExportSmoke(' + JSON.stringify(resolutions) + ', ' + durationSec + ')'
    )
    await writeFile(
      join(process.cwd(), 'smoke-export-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    const ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-export] 结果:', ok ? '全部成功' : '存在失败')
    console.log(JSON.stringify(report, null, 2))
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-export] 失败:', error)
    app.exit(1)
  }
}

async function runSmokeTest(win: BrowserWindow): Promise<void> {
  try {
    const result: unknown = await win.webContents.executeJavaScript('window.api.ping()')
    await writeFile(join(process.cwd(), 'smoke-result.txt'), 'PING_OK:' + String(result), 'utf-8')
    console.log('[smoke] IPC 往返成功:', result)
    app.exit(0)
  } catch (error) {
    await writeFile(join(process.cwd(), 'smoke-result.txt'), 'PING_FAIL:' + String(error), 'utf-8')
    console.error('[smoke] IPC 往返失败:', error)
    app.exit(1)
  }
}

if (isSmokeVisual || isSmokeExport) {
  // 无头自测：无用户手势也允许音频上下文运行
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
}

app.whenReady().then(async () => {
  // 来源矩阵自测：只做三源检测并落盘
  if (isSmokeDetect) {
    try {
      const status = await detectFfmpegStatus()
      await writeFile(
        join(process.cwd(), 'smoke-detect-report.json'),
        JSON.stringify(status, null, 2),
        'utf-8'
      )
      console.log(
        '[smoke-detect] effective:',
        JSON.stringify({
          available: status.effective.available,
          source: status.effective.source,
          path: status.effective.path,
          system: status.system?.version ?? null,
          managed: status.managed?.version ?? null,
          custom: status.custom?.version ?? null
        })
      )
      app.exit(0)
    } catch (error) {
      console.error('[smoke-detect] 失败:', error)
      app.exit(1)
    }
    return
  }

  // 托管安装自测：真实下载（或本地镜像）→ 解压 → 校验
  if (smokeDownloadArg) {
    try {
      const urlPart = smokeDownloadArg.split('=')[1] ?? 'default'
      const url = urlPart === 'default' ? undefined : urlPart
      console.log('[smoke-download] 开始安装，URL:', url ?? '(默认 gyan.dev)')
      const info = await installManagedFfmpeg({
        token: 'smoke-download',
        url,
        onProgress: (p) => {
          console.log(
            '[smoke-download]',
            p.phase,
            p.percent != null ? p.percent + '%' : '',
            p.message
          )
        }
      })
      const managed = await detectManagedFfmpeg()
      const report = { install: info, managed }
      await writeFile(
        join(process.cwd(), 'smoke-download-report.json'),
        JSON.stringify(report, null, 2),
        'utf-8'
      )
      console.log('[smoke-download] 安装成功:', info.version, '| aac:', info.hasAac)
      app.exit(0)
    } catch (error) {
      console.error('[smoke-download] 失败:', error)
      app.exit(1)
    }
    return
  }

  // 应用用户模型 ID（Windows 通知/任务栏分组）
  electronApp.setAppUserModelId('com.niko.karaoke')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  registerFfmpegIpc()

  const mainWindow = createWindow()
  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runSmokeTest(mainWindow)
    })
  }
  if (isSmokeVisual) {
    mainWindow.webContents.once('did-finish-load', () => {
      // 等待 React 挂载 + 合成封面加载 + Konva 缓存完成
      setTimeout(() => {
        void runSmokeVisual(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeExport) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeExport(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeBench) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeBench(mainWindow)
      }, 3500)
    })
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
