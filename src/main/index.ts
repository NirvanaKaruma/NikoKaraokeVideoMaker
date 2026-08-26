import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { writeFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC } from '../shared/ipc'

/** smoke 自测模式：加载渲染页后执行一次 ping 往返，结果写入 smoke-result.txt 并退出 */
const isSmokeTest = process.argv.includes('--smoke-test')

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
    if (!isSmokeTest) mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
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

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
