import { describe, expect, it } from 'vitest'
import { flashIntensity, grainOffset } from './canvasfx'
import type { BandEnergies } from './fx'

describe('canvasfx 时间确定性', () => {
  it('grainOffset：t 的纯函数（同 t 同值）；相邻 1/24s 网格不同', () => {
    const a = grainOffset(3.0)
    const b = grainOffset(3.0)
    expect(a).toEqual(b)
    const c = grainOffset(3.0 + 1 / 24)
    expect(a[0]).not.toBeCloseTo(c[0], 9)
    // 范围 [0,1)
    for (const v of [...grainOffset(1.234), ...grainOffset(9.876)]) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('flashIntensity：无采样器/强度 0 → 0；强烈阶跃 → 上限 1；平稳 → 0', () => {
    expect(flashIntensity(undefined, 1.0, 0.5)).toBe(0)
    const energy = (t: number): BandEnergies => ({
      bass: t >= 1 ? 1 : 0,
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    expect(flashIntensity(energy, 1.05, 0.5)).toBeCloseTo(0.6, 6) // 阶跃 1 × 0.5 × 1.2
    expect(flashIntensity(energy, 2.0, 0.5)).toBe(0) // 已稳定 → 无新阶跃
    const flat = (): BandEnergies => ({ bass: 0.9, lowMid: 0, mid: 0, treble: 0 })
    expect(flashIntensity(flat, 1.0, 1)).toBe(0)
    // 强度上限 1
    expect(flashIntensity(energy, 1.05, 2)).toBe(1)
  })
})
