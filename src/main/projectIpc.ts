import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { IPC } from '../shared/ipc'

const isSmoke = (): boolean => process.argv.some((a) => a.startsWith('--smoke-project'))

/** 项目保存/加载 IPC（T23）：保存对话框 + 原子写；smoke 模式免对话框 */
export function registerProjectIpc(): void {
  ipcMain.handle(IPC.projectSave, async (e, json: string, defaultName: string) => {
    let path: string
    if (isSmoke()) {
      const dir = join(process.cwd(), 'TEST-ARTIFACTS')
      await fs.mkdir(dir, { recursive: true })
      path = join(dir, (defaultName || 'smoke-project') + '.niko.json')
    } else {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = {
        title: '保存项目',
        defaultPath: (defaultName || '未命名项目') + '.niko.json',
        filters: [{ name: 'NikoKaraokeVideoMaker 项目', extensions: ['json'] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true, path: null }
      path = res.filePath
    }
    const tmp = path + '.tmp'
    await fs.writeFile(tmp, json, 'utf-8')
    await fs.rename(tmp, path)
    return { ok: true, canceled: false, path }
  })

  ipcMain.handle(IPC.projectLoad, async (e) => {
    let path: string
    if (isSmoke()) {
      path = join(process.cwd(), 'TEST-ARTIFACTS', 'smoke-project.niko.json')
    } else {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = {
        title: '打开项目',
        properties: ['openFile'] as Electron.OpenDialogOptions['properties'],
        filters: [{ name: 'NikoKaraokeVideoMaker 项目', extensions: ['json'] }]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true, json: null }
      path = res.filePaths[0]
    }
    try {
      const json = await fs.readFile(path, 'utf-8')
      return { ok: true, canceled: false, json }
    } catch (err) {
      return {
        ok: false,
        canceled: false,
        json: null,
        error: err instanceof Error ? err.message : String(err)
      }
    }
  })

  /** 读取文件字节（加载项目时把音频路径还原为 File） */
  ipcMain.handle(IPC.projectReadFile, async (_e, path: string) => {
    try {
      const buf = await fs.readFile(path)
      return { ok: true, buffer: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })
}
