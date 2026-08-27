import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { IPC } from '../shared/ipc'
import type {
  DownloadProgress,
  FfmpegConfig,
  FfmpegDetectInfo,
  FfmpegStatusReport,
  MergeProgress,
  MergeRequest
} from '../shared/ffmpeg'

// renderer 可用的自定义 API（全部经白名单 channel）
const api = {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.appPing),

  /** 界面语言（i18n）：读取/保存偏好 */
  getLocale: (): Promise<string> => ipcRenderer.invoke(IPC.appGetLocale),
  setLocale: (locale: string): Promise<string> => ipcRenderer.invoke(IPC.appSetLocale, locale),

  /** 获取拖放/选择文件的真实磁盘路径（导出合并 ffmpeg 需要） */
  getFilePath: (file: File): string => {
    try {
      return webUtils.getPathForFile(file)
    } catch {
      return ''
    }
  },

  ffmpeg: {
    detect: (): Promise<FfmpegStatusReport> => ipcRenderer.invoke(IPC.ffmpegDetect),
    getConfig: (): Promise<FfmpegConfig> => ipcRenderer.invoke(IPC.ffmpegConfigGet),
    setConfig: (patch: Partial<FfmpegConfig>): Promise<FfmpegConfig> =>
      ipcRenderer.invoke(IPC.ffmpegConfigSet, patch),
    validate: (path: string): Promise<FfmpegDetectInfo> =>
      ipcRenderer.invoke(IPC.ffmpegValidate, path),
    pickCustom: (): Promise<string | null> => ipcRenderer.invoke(IPC.ffmpegPickCustom),
    download: (
      token: string,
      url?: string
    ): Promise<{ ok: boolean; info?: FfmpegDetectInfo; error?: string }> =>
      ipcRenderer.invoke(IPC.ffmpegDownload, { token, url }),
    cancelDownload: (token: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.ffmpegDownloadCancel, token),
    onDownloadProgress: (cb: (p: DownloadProgress) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: DownloadProgress): void => cb(p)
      ipcRenderer.on(IPC.ffmpegDownloadProgress, listener)
      return () => ipcRenderer.removeListener(IPC.ffmpegDownloadProgress, listener)
    }
  },

  project: {
    save: (
      json: string,
      defaultName: string
    ): Promise<{ ok: boolean; canceled?: boolean; path: string | null }> =>
      ipcRenderer.invoke(IPC.projectSave, json, defaultName),
    load: (): Promise<{ ok: boolean; canceled?: boolean; json: string | null; error?: string }> =>
      ipcRenderer.invoke(IPC.projectLoad),
    readFile: (path: string): Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }> =>
      ipcRenderer.invoke(IPC.projectReadFile, path)
  },

  exportApi: {
    pickOutput: (defaultName: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.exportPickOutput, defaultName),
    saveVideo: (buffer: ArrayBuffer, name: string): Promise<string> =>
      ipcRenderer.invoke(IPC.exportSaveVideo, buffer, name),
    saveAudio: (buffer: ArrayBuffer, name: string): Promise<string> =>
      ipcRenderer.invoke(IPC.exportSaveAudio, buffer, name),
    merge: (req: MergeRequest & { mergeId: string }): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.exportMerge, req),
    cancelMerge: (mergeId: string): Promise<boolean> =>
      ipcRenderer.invoke(IPC.exportMergeCancel, mergeId),
    onMergeProgress: (cb: (p: MergeProgress) => void): (() => void) => {
      const listener = (_e: IpcRendererEvent, p: MergeProgress): void => cb(p)
      ipcRenderer.on(IPC.exportMergeProgress, listener)
      return () => ipcRenderer.removeListener(IPC.exportMergeProgress, listener)
    }
  }
}

export type NikoApi = typeof api

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
