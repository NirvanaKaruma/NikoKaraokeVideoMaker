import { ElectronAPI } from '@electron-toolkit/preload'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      /** M1 hello：ping → 'pong' */
      ping: () => Promise<string>
    }
  }
}

export {}
