import { describe, expect, it } from 'vitest'
import { buildAudioFilter } from './ffmpeg'

describe('buildAudioFilter（0.7.0 音频工程）', () => {
  it('全 0 → 空串（与 0.6.5 输出一致，不追加 -af）', () => {
    expect(buildAudioFilter(0, 0, 0, 222)).toBe('')
  })

  it('前导：adelay=lead:all=1,apad', () => {
    expect(buildAudioFilter(2000, 0, 0, 222)).toBe('adelay=2000:all=1,apad')
  })

  it('淡入/淡出（歌曲本体上，延迟前）：afade in st=0，out st=dur-fadeOut', () => {
    expect(buildAudioFilter(0, 0.5, 0, 222)).toBe('afade=t=in:st=0:d=0.500')
    expect(buildAudioFilter(0, 0, 0.8, 222)).toBe('afade=t=out:st=221.200:d=0.800')
  })

  it('组合顺序：淡入淡出 → adelay → apad', () => {
    const f = buildAudioFilter(1500, 0.3, 0.6, 100)
    expect(f).toBe('afade=t=in:st=0:d=0.300,afade=t=out:st=99.400:d=0.600,adelay=1500:all=1,apad')
  })

  it('淡出起点钳制 ≥0（超短音频 + 长淡出）', () => {
    const f = buildAudioFilter(0, 0, 3, 2)
    expect(f).toBe('afade=t=out:st=0.000:d=3.000')
  })
})
