import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC } from '../shared/ipc'

/** smoke 自测模式：加载渲染页后执行一次 ping 往返，结果写入 smoke-result.txt 并退出 */
const isSmokeTest = process.argv.includes('--smoke-test')
/** smoke-visual 模式：加载渲染页后截图舞台，写入 smoke-stage.png 并退出（M2 无头目视自测） */
const isSmokeVisual = process.argv.includes('--smoke-visual')

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
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (!isSmokeTest && !isSmokeVisual) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (isSmokeVisual) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeVisual: '1' } })
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
    await writeFile(
      join(process.cwd(), 'smoke-visual-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    const ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-visual] 像素校验:', ok ? '全部通过' : '存在失败项')
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-visual] 截图失败:', error)
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

app.whenReady().then(() => {
  // 应用用户模型 ID（Windows 通知/任务栏分组）
  electronApp.setAppUserModelId('com.niko.karaoke')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()

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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
