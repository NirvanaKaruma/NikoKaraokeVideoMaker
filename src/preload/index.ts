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
      ipcRenderer.invoke(IPC.projectReadFile, path),
    readBytes: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:read-bytes', path),
    audioDecode: (
      path: string
    ): Promise<{
      ok: boolean
      samples: ArrayBuffer | null
      sampleRate: number
      channels: number
      error: string | null
    }> => {
      // 流式解码：main 按 4MB 分块推送 → preload 组装（块间渲染进程可响应 UI，不冻结）
      return new Promise((resolve) => {
        const fail = (error: string): void =>
          resolve({ ok: false, samples: null, sampleRate: 0, channels: 0, error })
        void ipcRenderer
          .invoke('audio:decode-start', path)
          .then((token: unknown) => {
            const tok = String(token)
            let total = 0
            let meta: { sampleRate: number; channels: number } | null = null
            const parts: ArrayBuffer[] = []
            const onPcm = (
              _e: IpcRendererEvent,
              m: {
                token?: string
                type?: string
                data?: unknown
                error?: string
                sampleRate?: number
                channels?: number
              }
            ): void => {
              if (m.token !== tok) return
              if (m.type === 'chunk') {
                const d = m.data as ArrayBuffer
                parts.push(d)
                total += d.byteLength
              } else if (m.type === 'end') {
                if (m.sampleRate && m.channels) {
                  meta = { sampleRate: m.sampleRate, channels: m.channels }
                }
              } else if (m.type === 'error') {
                ipcRenderer.removeListener('audio:pcm', onPcm)
                fail(m.error ?? 'decode-failed')
              }
              if (meta && total > 0) {
                ipcRenderer.removeListener('audio:pcm', onPcm)
                const out = new ArrayBuffer(total)
                const u8 = new Uint8Array(out)
                let off = 0
                for (const p of parts) {
                  u8.set(new Uint8Array(p), off)
                  off += p.byteLength
                }
                resolve({
                  ok: true,
                  samples: out,
                  sampleRate: meta.sampleRate,
                  channels: meta.channels,
                  error: null
                })
              }
            }
            ipcRenderer.on('audio:pcm', onPcm)
          })
          .catch(() => fail('start-failed'))
      })
    }
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
