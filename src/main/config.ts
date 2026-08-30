import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import type { FfmpegConfig } from '../shared/ffmpeg'
import { normalizePrefs, type AppPrefs } from '../shared/appSettings'

interface AppConfig {
  /** 界面语言（i18n）：zh-cn | en | jp，默认 zh-cn */
  locale: string
  ffmpeg: FfmpegConfig
  /** 1.0.0 设置窗口重构：应用级偏好（主题/预览音量/自动保存/快捷键） */
  prefs: AppPrefs
}

const DEFAULT_CONFIG: AppConfig = {
  locale: 'zh-cn',
  ffmpeg: {
    source: 'system',
    customPath: '',
    downloadUrl: ''
  },
  prefs: normalizePrefs(null)
}

let cache: AppConfig | null = null

function configPath(): string {
  return join(app.getPath('userData'), 'config.json')
}

/** 读取配置（带缓存；文件缺失/损坏时回退默认值） */
export async function getConfig(): Promise<AppConfig> {
  if (cache) return cache
  try {
    const raw = await fs.readFile(configPath(), 'utf-8')
    const parsed = JSON.parse(raw) as Partial<AppConfig>
    cache = {
      locale: parsed.locale ?? DEFAULT_CONFIG.locale,
      ffmpeg: {
        source: parsed.ffmpeg?.source ?? DEFAULT_CONFIG.ffmpeg.source,
        customPath: parsed.ffmpeg?.customPath ?? '',
        downloadUrl: parsed.ffmpeg?.downloadUrl ?? ''
      },
      // 旧文件无 prefs → 全量默认；有则归一化合并（字段缺失/越界安全）
      prefs: normalizePrefs(parsed.prefs)
    }
  } catch {
    cache = structuredClone(DEFAULT_CONFIG)
  }
  return cache
}

/** 写入配置（原子写：临时文件 + 重命名） */
export async function setConfig(patch: {
  locale?: string
  ffmpeg?: Partial<FfmpegConfig>
  prefs?: Partial<AppPrefs>
}): Promise<AppConfig> {
  const current = await getConfig()
  const next: AppConfig = {
    locale: patch.locale ?? current.locale,
    ffmpeg: {
      source: patch.ffmpeg?.source ?? current.ffmpeg.source,
      customPath: patch.ffmpeg?.customPath ?? current.ffmpeg.customPath,
      downloadUrl: patch.ffmpeg?.downloadUrl ?? current.ffmpeg.downloadUrl
    },
    prefs: normalizePrefs({ ...current.prefs, ...(patch.prefs ?? {}) })
  }
  cache = next
  const path = configPath()
  const tmp = path + '.tmp'
  await fs.mkdir(join(path, '..'), { recursive: true }).catch(() => undefined)
  await fs.writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
  await fs.rename(tmp, path)
  return next
}

/** 托管版 ffmpeg.exe 所在目录（userData/ffmpeg/） */
export function managedFfmpegDir(): string {
  return join(app.getPath('userData'), 'ffmpeg')
}

export function managedFfmpegPath(): string {
  return join(managedFfmpegDir(), 'ffmpeg.exe')
}
