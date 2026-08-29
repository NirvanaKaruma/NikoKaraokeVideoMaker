/**
 * 超长音频护栏（0.7.0 T5 健康项）。
 *
 * 背景：解码通道内存随时长线性（44.1kHz 立体声 f32 ≈ 60min 1.27GB），
 * 超长音频会导致渲染进程 GC/OOM。策略：
 * - > AUDIO_DURATION_WARN_SEC（40min）→ 警告提示（仍可导入）
 * - > AUDIO_DURATION_REJECT_SEC（60min）→ 拒绝导入并明示原因（导入前先用
 *   ffmpeg -i 探测容器头时长，不解码）
 * - Worker 流式累计设硬上限（防御层：探测失败/缺失时兜底防 OOM）
 */

/** 警告阈值：超过 40 分钟提示（内存占用较高） */
export const AUDIO_DURATION_WARN_SEC = 40 * 60

/** 拒绝阈值：超过 60 分钟拒绝导入（保证渲染进程内存安全） */
export const AUDIO_DURATION_REJECT_SEC = 60 * 60

/** 时长策略：ok = 正常；warn = 超 40min 警告；reject = 超 60min 拒绝 */
export type AudioDurationPolicy = 'ok' | 'warn' | 'reject'

/** 纯函数：时长（秒）→ 策略。边界语义：恰好 40/60min 不触发（需严格大于）。 */
export function audioDurationPolicy(durationSec: number): AudioDurationPolicy {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 'ok'
  if (durationSec > AUDIO_DURATION_REJECT_SEC) return 'reject'
  if (durationSec > AUDIO_DURATION_WARN_SEC) return 'warn'
  return 'ok'
}

/** Worker 流式解码累计字节硬上限（防御层）：按最坏情况 48kHz 立体声 f32 计，
 * 达到即中止（清空已收块 + 报 too-long），防止探测失败时内存仍线性增长。 */
export const MAX_DECODE_STREAM_BYTES = AUDIO_DURATION_REJECT_SEC * 48000 * 2 * 4
