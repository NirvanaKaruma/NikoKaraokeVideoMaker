import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  DownloadProgress,
  FfmpegConfig,
  FfmpegDetectInfo,
  FfmpegStatusReport,
  MergeProgress,
  MergeRequest
} from '../shared/ffmpeg'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      /** M1 hello：ping → 'pong' */
      ping: () => Promise<string>
      /** 界面语言（i18n）：读取/保存偏好 */
      getLocale: () => Promise<string>
      setLocale: (locale: string) => Promise<string>
      /** 获取文件的真实磁盘路径（无法获取时返回空串） */
      getFilePath: (file: File) => string
      ffmpeg: {
        detect: () => Promise<FfmpegStatusReport>
        getConfig: () => Promise<FfmpegConfig>
        setConfig: (patch: Partial<FfmpegConfig>) => Promise<FfmpegConfig>
        validate: (path: string) => Promise<FfmpegDetectInfo>
        pickCustom: () => Promise<string | null>
        download: (
          token: string,
          url?: string
        ) => Promise<{ ok: boolean; info?: FfmpegDetectInfo; error?: string }>
        cancelDownload: (token: string) => Promise<boolean>
        onDownloadProgress: (cb: (p: DownloadProgress) => void) => () => void
      }
      project: {
        save: (
          json: string,
          defaultName: string
        ) => Promise<{ ok: boolean; canceled?: boolean; path: string | null }>
        load: () => Promise<{
          ok: boolean
          canceled?: boolean
          json: string | null
          error?: string
        }>
        readFile: (path: string) => Promise<{ ok: boolean; buffer?: ArrayBuffer; error?: string }>
        readBytes: (path: string) => Promise<Uint8Array>
      }
      exportApi: {
        pickOutput: (defaultName: string) => Promise<string | null>
        saveVideo: (buffer: ArrayBuffer, name: string) => Promise<string>
        saveAudio: (buffer: ArrayBuffer, name: string) => Promise<string>
        merge: (req: MergeRequest & { mergeId: string }) => Promise<{ ok: boolean; error?: string }>
        cancelMerge: (mergeId: string) => Promise<boolean>
        onMergeProgress: (cb: (p: MergeProgress) => void) => () => void
      }
    }
  }
}

export {}
