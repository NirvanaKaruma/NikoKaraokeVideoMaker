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

  /** 应用级偏好（1.0.0 设置重构）：整体读写（main 归一化持久化） */
  appPrefs: {
    get: (): Promise<import('../shared/appSettings').AppPrefs> =>
      ipcRenderer.invoke(IPC.appPrefsGet),
    set: (
      patch: import('../shared/appSettings').AppPrefs
    ): Promise<import('../shared/appSettings').AppPrefs> =>
      ipcRenderer.invoke(IPC.appPrefsSet, patch)
  },

  /** 自更新（1.0.0）：GitHub 检测 + 下载 + portable 自替换 */
  updater: {
    check: (): Promise<import('../shared/updater').UpdateCheckResult> =>
      ipcRenderer.invoke(IPC.updaterCheck),
    download: (
      jobId: string,
      url: string,
      sha256?: string | null
    ): Promise<{ ok: boolean; path?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.updaterDownload, jobId, url, sha256 ?? null),
    apply: (path: string): Promise<{ ok: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.updaterApply, path),
    onDownloadProgress: (
      cb: (p: import('../shared/updater').DownloadProgress) => void
    ): (() => void) => {
      const listener = (
        _e: Electron.IpcRendererEvent,
        p: import('../shared/updater').DownloadProgress
      ): void => cb(p)
      ipcRenderer.on(IPC.updaterDownloadProgress, listener)
      return () => ipcRenderer.removeListener(IPC.updaterDownloadProgress, listener)
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
    /** 音频时长探测（0.7.0 护栏）：ffmpeg -i 容器头（不解码）；ffmpeg 缺失/失败 = null */
    audioProbeDuration: (path: string): Promise<number | null> =>
      ipcRenderer.invoke(IPC.audioProbeDuration, path),
    save: (
      json: string,
      defaultName: string
    ): Promise<{ ok: boolean; canceled?: boolean; path: string | null }> =>
      ipcRenderer.invoke(IPC.projectSave, json, defaultName),
    saveTo: (
      json: string,
      path: string
    ): Promise<{ ok: boolean; canceled?: boolean; path: string | null }> =>
      ipcRenderer.invoke(IPC.projectSaveTo, json, path),
    load: (): Promise<{
      ok: boolean
      canceled?: boolean
      json: string | null
      path?: string | null
      error?: string
    }> => ipcRenderer.invoke(IPC.projectLoad),
    readFile: (path: string): Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }> =>
      ipcRenderer.invoke(IPC.projectReadFile, path),
    readBytes: (path: string): Promise<Uint8Array> => ipcRenderer.invoke('fs:read-bytes', path),
    /**
     * P0 音频解码（文件流式）：main 用 ffmpeg 解码到临时 PCM 文件后，渲染侧按 4MB 分块
     * 拉取（audioDecodeRead）→ transfer 进 Worker。start 返回 {token, path}；
     * read(token, offset, len) → {bytes, eof}；dispose(token) 释放（读毕/失败/取消后调用）。
     * cancel：中止（换文件/新建项目时调用，杀掉 main 侧 ffmpeg 子进程）。
     */
    audioDecodeStart: (
      path: string
    ): Promise<{
      ok: boolean
      token?: string
      path?: string
      sampleRate?: number
      channels?: number
      error?: string
    }> => ipcRenderer.invoke(IPC.audioDecodeStart, path),
    audioDecodeRead: (
      token: string,
      offset: number,
      length: number
    ): Promise<{ ok: boolean; bytes?: ArrayBuffer; eof?: boolean; error?: string }> =>
      ipcRenderer.invoke(IPC.audioDecodeRead, token, offset, length),
    audioDecodeDispose: (token: string): Promise<void> =>
      ipcRenderer.invoke(IPC.audioDecodeDispose, token),
    audioDecodeCancel: (token: string): Promise<void> =>
      ipcRenderer.invoke(IPC.audioDecodeCancel, token)
  },

  /** 1.0.0 T7b 流式写盘：invoke 分块写（ACK = fs write 回调；窗口 1 块；position=字节偏移定位写） */
  muxer: {
    start: (hintName: string): Promise<{ jobId: string }> =>
      ipcRenderer.invoke(IPC.muxerStart, hintName),
    write: (jobId: string, buffer: ArrayBuffer, position: number): Promise<void> =>
      ipcRenderer.invoke(IPC.muxerWrite, jobId, buffer, position),
    finish: (jobId: string): Promise<{ ok: boolean; target?: string; error?: string }> =>
      ipcRenderer.invoke(IPC.muxerFinish, jobId),
    cancel: (jobId: string): Promise<boolean> => ipcRenderer.invoke(IPC.muxerCancel, jobId)
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
