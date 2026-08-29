/** ffmpeg 三源管理共享类型 */

export type FfmpegSource = 'system' | 'managed' | 'custom'

export interface FfmpegConfig {
  /** 用户选择的来源：system=PATH / managed=托管下载 / custom=手动指定 */
  source: FfmpegSource
  /** 手动指定的 ffmpeg.exe 路径 */
  customPath: string
  /** 托管下载 URL 覆盖（空 = 默认 gyan.dev；支持镜像前缀） */
  downloadUrl: string
}

export interface FfmpegDetectInfo {
  status: 'ok' | 'error'
  path: string
  version: string
  /** aac 编码器（必须；缺失视为不可用） */
  hasAac: boolean
  /** libx264（可选；缺失仅警告） */
  hasLibx264: boolean
  /** 硬件编码器（ffmpeg 侧检测，仅信息展示；当前管线视频编码在 WebCodecs，ffmpeg 只做无损混流） */
  hasNvenc: boolean
  hasQsv: boolean
  hasAmf: boolean
  /** -hwaccels 列表（cuda/d3d11va/qsv 等） */
  hwaccels: string[]
  error?: string
}

export interface EffectiveFfmpeg {
  available: boolean
  source: FfmpegSource | null
  path: string | null
  info: FfmpegDetectInfo | null
}

/** detect 返回：三源各自状态 + 当前生效结果 */
export interface FfmpegStatusReport {
  system: FfmpegDetectInfo | null
  managed: FfmpegDetectInfo | null
  custom: FfmpegDetectInfo | null
  effective: EffectiveFfmpeg
  config: FfmpegConfig
}

export interface DownloadProgress {
  phase: 'downloading' | 'extracting' | 'validating' | 'done' | 'error'
  /** 0–100（downloading/extracting 时有效，其余为 null） */
  percent: number | null
  message: string
}

export interface MergeRequest {
  videoPath: string
  audioPath: string
  outputPath: string
  /** 音频时长 ms（用于合并进度百分比与淡出起点） */
  durationMs: number
  /** 音频工程（0.7.0）：缺省 = 全关 */
  audioEngine?: { leadMs: number; fadeInSec: number; fadeOutSec: number }
}

/** 音频滤镜构造（0.7.0 纯函数）：淡入/淡出作用于歌曲本体（延迟之前）→ 前导 adelay → apad。
 * 全部为 0 时返回 ''（不追加 -af，与 0.6.5 输出一致）。 */
export function buildAudioFilter(
  leadMs: number,
  fadeInSec: number,
  fadeOutSec: number,
  durationSec: number
): string {
  const parts: string[] = []
  if (fadeInSec > 0) parts.push(`afade=t=in:st=0:d=${fadeInSec.toFixed(3)}`)
  if (fadeOutSec > 0) {
    const st = Math.max(0, durationSec - fadeOutSec)
    parts.push(`afade=t=out:st=${st.toFixed(3)}:d=${fadeOutSec.toFixed(3)}`)
  }
  if (leadMs > 0) parts.push(`adelay=${leadMs}:all=1`)
  if (leadMs > 0) parts.push('apad')
  return parts.join(',')
}

export interface MergeProgress {
  /** 0–100 或 null（不确定阶段） */
  percent: number | null
  message: string
}

/** 默认托管下载源（Q3：gyan.dev release-essentials；可在设置中覆盖） */
export const DEFAULT_FFMPEG_DOWNLOAD_URL =
  'https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip'
