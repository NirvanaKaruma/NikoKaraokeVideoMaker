import { BrowserWindow, dialog, ipcMain } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { IPC } from '../shared/ipc'
import { t } from '../shared/i18n'

/** 项目文件扩展名（专有后缀，M5 用户反馈） */
export const PROJECT_EXTENSION = 'niko'

const isSmoke = (): boolean =>
  process.argv.some((a) => a.startsWith('--smoke-project')) ||
  process.env['NIKO_SMOKE'] === 'project'
const smokeDir = (): string => process.env['NIKO_SMOKE_DIR'] ?? process.cwd()

/* ---------------- 存档加密混淆（AES-256-GCM） ---------------- */

/** 文件魔数：NIKO1 */
const MAGIC = Buffer.from('NIKO1', 'latin1')
/** 混淆密钥（内置；防直接查看/手改，非抗逆向强加密——本应用不承载敏感数据） */
const KEY = Buffer.from('4f6a1c9e8b2d7f3a5c1e9b8d2f7a3c5e4f6a1c9e8b2d7f3a5c1e9b8d2f7a3c5e', 'hex')

/** 明文 JSON → NIKO1 + IV + authTag + 密文 */
function encryptProject(json: string): Buffer {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', KEY, iv)
  const enc = Buffer.concat([cipher.update(json, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, iv, tag, enc])
}

/** 密文 → 明文 JSON；兼容旧版明文（以 { 开头视为明文） */
function decryptProject(buf: Buffer): string {
  const head = buf.subarray(0, 5)
  if (head.equals(MAGIC)) {
    const iv = buf.subarray(5, 17)
    const tag = buf.subarray(17, 33)
    const enc = buf.subarray(33)
    const decipher = createDecipheriv('aes-256-gcm', KEY, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf-8')
  }
  // 旧版明文回退
  const text = buf.toString('utf-8').trimStart()
  if (text.startsWith('{')) return text
  throw new Error(t('ffmpeg.invalidProject'))
}

/** 项目保存/加载 IPC（T23）：保存对话框 + 加密写；smoke 模式免对话框 */
export function registerProjectIpc(): void {
  ipcMain.handle(IPC.projectSave, async (e, json: string, defaultName: string) => {
    let path: string
    if (isSmoke()) {
      const dir = join(smokeDir(), 'TEST-ARTIFACTS')
      await fs.mkdir(dir, { recursive: true })
      path = join(dir, (defaultName || 'smoke-project') + '.' + PROJECT_EXTENSION)
    } else {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = {
        title: t('dialogs.saveProject'),
        defaultPath: (defaultName || '未命名项目') + '.' + PROJECT_EXTENSION,
        filters: [{ name: t('dialogs.projectFilter'), extensions: [PROJECT_EXTENSION] }]
      }
      const res = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
      if (res.canceled || !res.filePath) return { ok: false, canceled: true, path: null }
      path = res.filePath
    }
    const tmp = path + '.tmp'
    await fs.writeFile(tmp, encryptProject(json))
    await fs.rename(tmp, path)
    return { ok: true, canceled: false, path }
  })

  // 1.0.0 自动保存：静默写指定路径（无对话框）；非法/空路径返回 canceled
  ipcMain.handle(IPC.projectSaveTo, async (_e, json: string, path: string) => {
    if (typeof path !== 'string' || !path.trim()) {
      return { ok: false, canceled: true, path: null }
    }
    const tmp = path + '.tmp'
    await fs.writeFile(tmp, encryptProject(json))
    await fs.rename(tmp, path)
    return { ok: true, canceled: false, path }
  })

  ipcMain.handle(IPC.projectLoad, async (e) => {
    let path: string
    if (isSmoke()) {
      path = join(smokeDir(), 'TEST-ARTIFACTS', 'smoke-project.' + PROJECT_EXTENSION)
    } else {
      const win = BrowserWindow.fromWebContents(e.sender)
      const opts = {
        title: t('dialogs.openProject'),
        properties: ['openFile'] as Electron.OpenDialogOptions['properties'],
        filters: [{ name: t('dialogs.projectFilter'), extensions: [PROJECT_EXTENSION, 'json'] }]
      }
      const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
      if (res.canceled || !res.filePaths[0]) return { ok: false, canceled: true, json: null }
      path = res.filePaths[0]
    }
    try {
      const buf = await fs.readFile(path)
      const json = decryptProject(buf)
      return { ok: true, canceled: false, json, path }
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
