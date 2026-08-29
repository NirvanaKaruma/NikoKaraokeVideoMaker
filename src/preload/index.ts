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
    /**
     * 流式音频解码：main 的 4MB PCM 分块原样直通 onChunk（preload 不再全量组装复制，
     * 渲染进程块间可响应 UI）；result 在流结束/失败时 resolve（声道数与采样率）。
     * cancel：中止本次解码（渲染端换文件/新建项目时调用，杀掉 main 侧 ffmpeg 子进程）。
     */
    audioDecode: (
      path: string,
      onChunk: (data: ArrayBuffer) => void
    ): {
      result: Promise<{
        ok: boolean
        sampleRate: number
        channels: number
        error: string | null
      }>
      cancel: () => void
    } => {
      let settled = false
      let token = ''
      let resolveFn:
        | ((r: { ok: boolean; sampleRate: number; channels: number; error: string | null }) => void)
        | null = null
      let onPcm: ((_e: IpcRendererEvent, m: Record<string, unknown>) => void) | null = null
      const cleanup = (): void => {
        if (onPcm) {
          ipcRenderer.removeListener('audio:pcm', onPcm)
          onPcm = null
        }
      }
      const finish = (r: {
        ok: boolean
        sampleRate: number
        channels: number
        error: string | null
      }): void => {
        if (settled) return
        settled = true
        cleanup()
        resolveFn?.(r)
      }
      const result = new Promise<{
        ok: boolean
        sampleRate: number
        channels: number
        error: string | null
      }>((resolve) => {
        resolveFn = resolve
      })
      void ipcRenderer
        .invoke('audio:decode-start', path)
        .then((tok: unknown) => {
          if (settled) return
          token = String(tok)
          onPcm = (_e, m) => {
            if (m.token !== token) return
            if (m.type === 'chunk') {
              try {
                onChunk(m.data as ArrayBuffer)
              } catch {
                finish({ ok: false, sampleRate: 0, channels: 0, error: 'chunk-forward-failed' })
              }
            } else if (m.type === 'end') {
              finish({
                ok: true,
                sampleRate: (m.sampleRate as number) ?? 0,
                channels: (m.channels as number) ?? 0,
                error: null
              })
            } else if (m.type === 'error') {
              finish({
                ok: false,
                sampleRate: 0,
                channels: 0,
                error: (m.error as string) ?? 'decode-failed'
              })
            }
          }
          ipcRenderer.on('audio:pcm', onPcm)
        })
        .catch(() => finish({ ok: false, sampleRate: 0, channels: 0, error: 'start-failed' }))
      return {
        result,
        cancel: () => {
          finish({ ok: false, sampleRate: 0, channels: 0, error: 'cancelled' })
          if (token) void ipcRenderer.invoke('audio:decode-cancel', token)
        }
      }
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
