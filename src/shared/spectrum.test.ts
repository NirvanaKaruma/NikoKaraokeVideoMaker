import { describe, expect, it } from 'vitest'
import { createSpectrumAnalyzer, mixToMono, smoothBars, spectrumAt } from './spectrum'

function makeSine(freq: number, sr: number, seconds: number, amp = 0.8): Float32Array {
  const n = Math.round(sr * seconds)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / sr)
  return out
}

describe('共享频谱分析器', () => {
  it('440Hz 正弦的能量集中在对应柱（对数分桶命中）', () => {
    const sr = 8000
    const analyzer = createSpectrumAnalyzer(makeSine(440, sr, 2), sr, {
      fftSize: 2048,
      freqMin: 30,
      freqMax: 4000
    })
    const bars = spectrumAt(analyzer, 1.0, 128)
    let maxIdx = 0
    for (let i = 1; i < bars.length; i++) if (bars[i] > bars[maxIdx]) maxIdx = i
    // 440Hz 在对数桶中的位置
    const ratio = 4000 / 30
    const expected = (Math.log(440 / 30) / Math.log(ratio)) * 128
    expect(Math.abs(maxIdx - expected)).toBeLessThanOrEqual(4)
    expect(bars[maxIdx]).toBeGreaterThan(0.5)
    // 100Hz（远低于 440）应远小于峰值
    const lowIdx = Math.round((Math.log(100 / 30) / Math.log(4000 / 30)) * 128)
    expect(bars[lowIdx]).toBeLessThan(bars[maxIdx] * 0.4)
  })

  it('静音输入 → 全零柱', () => {
    const analyzer = createSpectrumAnalyzer(new Float32Array(8000), 8000, { fftSize: 2048 })
    const bars = spectrumAt(analyzer, 0.5, 128)
    for (const v of bars) expect(v).toBe(0)
  })

  it('时间平滑：smoothing=0 跟随新值，0.5 取均值，越界钳制', () => {
    const prev = new Float32Array([0, 1, 0])
    const target = new Float32Array([1, 0, 1])
    const none = smoothBars(null, target, 0.5)
    expect(Array.from(none)).toEqual([1, 0, 1])
    const half = smoothBars(prev, target, 0.5)
    expect(half[0]).toBeCloseTo(0.5, 5)
    expect(half[1]).toBeCloseTo(0.5, 5)
    expect(half[2]).toBeCloseTo(0.5, 5)
    const follow = smoothBars(prev, target, 0)
    expect(Array.from(follow)).toEqual([1, 0, 1])
  })

  it('双声道混单声道', () => {
    const a = new Float32Array([0.5, 0.5, 0.5])
    const b = new Float32Array([0.1, 0.1, 0.1])
    const mono = mixToMono([a, b], 3)
    expect(mono[0]).toBeCloseTo(0.3, 5)
  })

  it('灵敏度增益：gain 翻倍 → 未饱和柱高度翻倍', () => {
    const analyzer = createSpectrumAnalyzer(makeSine(440, 8000, 2), 8000, {
      fftSize: 2048,
      freqMin: 30,
      freqMax: 4000
    })
    const low = spectrumAt(analyzer, 1.0, 128, null, 2)
    const high = spectrumAt(analyzer, 1.0, 128, null, 4)
    for (let i = 0; i < low.length; i++) {
      if (high[i] < 0.99) {
        expect(high[i]).toBeCloseTo(low[i] * 2, 4)
      }
    }
  })

  it('频率范围钳制：freqMax 不超过奈奎斯特、freqMin<freqMax（非法输入被纠正）', () => {
    const sr = 8000
    // freqMin=5 合法但 freqMax=16000 超过奈奎斯特 4000 → 被钳到 4000
    const a = createSpectrumAnalyzer(makeSine(440, sr, 2), sr, {
      fftSize: 2048,
      freqMin: 30,
      freqMax: 16000
    })
    expect(a.freqMax).toBe(4000)
    // freqMin ≥ freqMax 的退化输入：强制频带宽度至少 1Hz
    const b = createSpectrumAnalyzer(makeSine(440, sr, 2), sr, {
      fftSize: 2048,
      freqMin: 5000,
      freqMax: 100
    })
    expect(b.freqMin).toBeLessThan(b.freqMax)
  })

  it('同一音高在更窄的频率范围中柱位更靠右（频率范围=固定的量尺）', () => {
    const sr = 44100
    const tone = makeSine(440, sr, 2)
    const wide = createSpectrumAnalyzer(tone, sr, { fftSize: 2048, freqMin: 30, freqMax: 16000 })
    const narrow = createSpectrumAnalyzer(tone, sr, { fftSize: 2048, freqMin: 30, freqMax: 4000 })
    const bw = spectrumAt(wide, 1.0, 128)
    const bn = spectrumAt(narrow, 1.0, 128)
    let iw = 0
    let ni = 0
    for (let i = 1; i < 128; i++) {
      if (bw[i] > bw[iw]) iw = i
      if (bn[i] > bn[ni]) ni = i
    }
    // 30–16000 中 440Hz ≈ 55 柱；30–4000 中 ≈ 70 柱
    expect(iw).toBeGreaterThan(45)
    expect(iw).toBeLessThan(65)
    expect(ni).toBeGreaterThan(60)
    expect(ni).toBeLessThan(85)
  })

  it('平滑处理柱数变化：prev 长度不一致时直接取 target（无 NaN）', () => {
    const prev = new Float32Array([0.5, 0.2])
    const target = new Float32Array([0.8, 0.3, 0.1, 0.7, 0.6])
    const res = smoothBars(prev, target, 0.5)
    expect(res.length).toBe(5)
    for (const v of res) expect(Number.isFinite(v)).toBe(true)
  })

  it('时刻越界按边缘钳制，不抛异常', () => {
    const analyzer = createSpectrumAnalyzer(makeSine(440, 8000, 1), 8000)
    expect(spectrumAt(analyzer, -1, 64).length).toBe(64)
    expect(spectrumAt(analyzer, 999, 64).length).toBe(64)
  })
})
