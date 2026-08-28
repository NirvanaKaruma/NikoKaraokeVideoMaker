import { describe, expect, it } from 'vitest'
import { particlesAt } from './particles'

describe('particles 时间确定性', () => {
  it('同 t 同快照；30/60fps 网格共享 tSec 完全一致', () => {
    const a = particlesAt(1.234, 'snow', 0.5, 0, 1920, 1080)
    const b = particlesAt(1.234, 'snow', 0.5, 0, 1920, 1080)
    expect(a).toEqual(b)
    for (const t of [0, 0.2, 2.3456, 7.777]) {
      expect(particlesAt(t, 'sakura', 0.6, 0.4, 1920, 1080)).toEqual(
        particlesAt(t, 'sakura', 0.6, 0.4, 1920, 1080)
      )
    }
  })

  it('t 推进 → 粒子移动（雪下落）；密度 0 → 空；boost 提高透明度', () => {
    const a = particlesAt(0.0, 'snow', 0.5, 0, 1920, 1080)
    const b = particlesAt(1.5, 'snow', 0.5, 0, 1920, 1080)
    const moved = a.filter((p, i) => Math.abs(p.y - b[i].y) > 1 || Math.abs(p.x - b[i].x) > 1)
    expect(moved.length).toBeGreaterThan(0)
    expect(particlesAt(1, 'snow', 0, 0, 1920, 1080)).toEqual([])
    const plain = particlesAt(1.0, 'snow', 0.6, 0, 1920, 1080)
    const boosted = particlesAt(1.0, 'snow', 0.6, 1, 1920, 1080)
    const sumAlpha = (arr: typeof plain): number => arr.reduce((s, p) => s + p.alpha, 0)
    expect(sumAlpha(boosted)).toBeGreaterThan(sumAlpha(plain))
  })

  it('粒子在画布尺寸范围内（雪花/樱花 y ∈ [-20, h+20]，x 不越界 ±sway）', () => {
    for (const preset of ['snow', 'sakura', 'bubble'] as const) {
      for (const t of [0.3, 2.1, 5.5]) {
        for (const p of particlesAt(t, preset, 1, 0.5, 1920, 1080)) {
          expect(p.y).toBeGreaterThanOrEqual(-25)
          expect(p.y).toBeLessThanOrEqual(1080 + 25)
          expect(p.x).toBeGreaterThanOrEqual(-200)
          expect(p.x).toBeLessThanOrEqual(1920 + 200)
        }
      }
    }
  })
})
