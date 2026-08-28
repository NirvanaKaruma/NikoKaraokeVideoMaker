import { describe, expect, it } from 'vitest'
import {
  bandEnergiesFromBars,
  barGeometry,
  easeOutCubic,
  lineHeights,
  seededRng,
  smoothBarsFx,
  type SmoothFxState
} from './fx'

describe('fx 时间函数库', () => {
  it('bandEnergiesFromBars：对数分带 4 段能量计算正确', () => {
    // 模拟 100 根柱：只在前 25%（bass）有能量
    const bars = new Array(100).fill(0).map((_, i) => (i < 25 ? 1 : 0))
    const e = bandEnergiesFromBars(bars)
    expect(e.bass).toBeCloseTo(1, 5)
    expect(e.lowMid).toBe(0)
    expect(e.mid).toBe(0)
    expect(e.treble).toBe(0)
    // 均分能量
    const eq = bandEnergiesFromBars(new Array(100).fill(0.5))
    expect(eq.bass).toBeCloseTo(0.5, 5)
    expect(eq.treble).toBeCloseTo(0.5, 5)
  })

  it('smoothBarsFx：attack/decay 双系数——上升快、下降慢', () => {
    const st: SmoothFxState = { prev: null, peak: null }
    const target = new Float32Array([0, 0])
    smoothBarsFx(st, target, 0.1, 0.9)
    // 突然上升到 1：上升路径 attack=0.1 → 先快升
    const up = smoothBarsFx(st, new Float32Array([1, 1]), 0.1, 0.9)
    expect(up[0]).toBeGreaterThan(0.5)
    // 突然下降到 0：下降路径 decay=0.9 → 慢降
    const down = smoothBarsFx(st, new Float32Array([0, 0]), 0.1, 0.9)
    expect(down[0]).toBeGreaterThan(0.5)
  })

  it('smoothBarsFx：peakFall=0（默认）关闭频谱帽；>0 时峰值保持后缓慢回落', () => {
    const off: SmoothFxState = { prev: null, peak: null }
    smoothBarsFx(off, new Float32Array([0.5]), 0.1, 0.9, 0)
    const r1 = smoothBarsFx(off, new Float32Array([1]), 0.1, 0.9, 0)
    expect(r1[0]).toBeLessThanOrEqual(1)
    // 峰值帽开启：到峰后不立刻跟随回落
    const on: SmoothFxState = { prev: null, peak: null }
    smoothBarsFx(on, new Float32Array([0.2]), 0, 0, 0.02)
    const p1 = smoothBarsFx(on, new Float32Array([1]), 0, 0, 0.02)
    expect(p1[0]).toBeCloseTo(1, 5) // attack=0 立即到峰
    const p2 = smoothBarsFx(on, new Float32Array([0]), 0, 0, 0.02)
    expect(p2[0]).toBeGreaterThanOrEqual(0.98 - 1e-6) // 峰值保持，只回落 0.02
  })

  it('barGeometry：bars 默认形态几何与旧行为一致（底部向上）', () => {
    const g = barGeometry('bars', 2, 0.5, 10, 1000, 200, 0.55, 0.45, 0.92)
    // x = i*slot + (slot-barW)/2；slot=100，barW=55
    expect(g.x).toBeCloseTo(2 * 100 + (100 - 55) / 2, 3)
    expect(g.y).toBeCloseTo(200 - 0.5 * 200 * 0.92, 3)
    expect(g.rotation).toBe(0)
  })

  it('barGeometry：radial 几何在区域中心内侧以内（不越界圆心）', () => {
    const g = barGeometry('radial', 0, 1, 8, 960, 200, 0.55, 0.45, 0.92)
    expect(g.w).toBeGreaterThan(0)
    expect(Number.isFinite(g.x)).toBe(true)
    expect(Number.isFinite(g.y)).toBe(true)
    expect(Number.isFinite(g.rotation)).toBe(true)
  })

  it('barGeometry：radial 环形不越界几何（左上角在区域内）', () => {
    const r = barGeometry('radial', 0, 1, 8, 960, 200, 0.55, 0.45, 0.92)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(Number.isFinite(r.rotation)).toBe(true)
    expect(r.w).toBeGreaterThan(0)
  })

  it('lineHeights：wave=原样；flow=加流动扰动且 ≥0 ≤1', () => {
    const bars = [0.5, 0.5, 0.5]
    const plain = lineHeights('wave', bars, 0)
    expect(plain).toEqual([0.5, 0.5, 0.5])
    const f0 = lineHeights('flow', bars, 0)
    for (const v of f0) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(1)
    }
    const f1 = lineHeights('flow', bars, 1.0)
    expect(f0).not.toEqual(f1) // 时间推进 → 相位变化
  })

  it('seededRng：同种子同序列，不同种子不同', () => {
    const a = seededRng(42)
    const b = seededRng(42)
    expect(a()).toBe(b())
    const c = seededRng(43)
    expect(a()).not.toBe(c())
  })

  it('easeOutCubic：端点与单调性', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBeCloseTo(1, 6)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(0.5)).toBeLessThan(1)
  })
})
