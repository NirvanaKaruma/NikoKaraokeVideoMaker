import { describe, expect, it } from 'vitest'
import {
  AUDIO_DURATION_REJECT_SEC,
  AUDIO_DURATION_WARN_SEC,
  MAX_DECODE_STREAM_BYTES,
  audioDurationPolicy
} from './audioGuard'

describe('audioDurationPolicy（0.7.0 超长音频护栏）', () => {
  it('正常时长 → ok（0 / 10min / 40min 整点边界不触发）', () => {
    expect(audioDurationPolicy(0)).toBe('ok')
    expect(audioDurationPolicy(10 * 60)).toBe('ok')
    expect(audioDurationPolicy(AUDIO_DURATION_WARN_SEC)).toBe('ok')
    expect(audioDurationPolicy(AUDIO_DURATION_REJECT_SEC)).toBe('warn') // 恰 60min 未超限
  })

  it('>40min → warn（44.1min / 59min 均警告）', () => {
    expect(audioDurationPolicy(44.1 * 60)).toBe('warn')
    expect(audioDurationPolicy(59 * 60)).toBe('warn')
  })

  it('>60min → reject（61min / 3h 均拒绝；负值/NaN 按 ok 兜底）', () => {
    expect(audioDurationPolicy(61 * 60)).toBe('reject')
    expect(audioDurationPolicy(3 * 3600)).toBe('reject')
    expect(audioDurationPolicy(-5)).toBe('ok')
    expect(audioDurationPolicy(Number.NaN)).toBe('ok')
  })

  it('阈值常量：40min / 60min；流式字节上限 = 60min×48kHz×2ch×4B 且为有限正数', () => {
    expect(AUDIO_DURATION_WARN_SEC).toBe(40 * 60)
    expect(AUDIO_DURATION_REJECT_SEC).toBe(60 * 60)
    expect(MAX_DECODE_STREAM_BYTES).toBe(3600 * 48000 * 2 * 4)
    expect(Number.isFinite(MAX_DECODE_STREAM_BYTES)).toBe(true)
  })
})
