import { describe, expect, it } from 'vitest'
import { THEME_FALLBACK, themeFromSamples } from './theme'

/** 构造像素样本：fill(r,g,b, n) 生成 n 个同色像素 */
function fill(r: number, g: number, b: number, n: number): number[] {
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(r, g, b)
  return out
}

describe('themeFromSamples（0.8.0 自动主题色）', () => {
  it('纯色样本 → 主色等于该色；背景=压暗 18% 亮度；双色 = [主色, 亮 25% 变体]', () => {
    const p = themeFromSamples(fill(128, 64, 200, 16), 16)
    expect(p.vizColors[0]).toBe('#8040c8')
    // 背景更暗（HSL 亮度 -0.18）：#8040c8 → 亮度约 0.37 → 0.19
    expect(p.bg).not.toBe(p.vizColors[0])
    expect(p.vizColors[1]).not.toBe(p.vizColors[0])
    // 确定性
    expect(themeFromSamples(fill(128, 64, 200, 16), 16)).toEqual(p)
  })

  it('确定性：混合样本两次调用结果完全一致；主色=最高频桶', () => {
    // 60% 蓝、40% 绿——最高频桶为蓝系
    const samples = [...fill(30, 60, 220, 6), ...fill(40, 180, 60, 4)]
    const a = themeFromSamples(samples, 10)
    const b = themeFromSamples(samples, 10)
    expect(a).toEqual(b)
    const hexes = a.vizColors[0].slice(1).match(/.{2}/g) ?? []
    const g = parseInt(hexes[1] ?? '0', 16)
    expect(g).toBeLessThan(180) // 主色偏蓝（绿通道低）
  })

  it('过暗/过曝像素被过滤；全过滤 → 回退默认主题', () => {
    // 全黑 + 全白 → 全部过滤 → fallback
    const p = themeFromSamples([...fill(5, 5, 5, 4), ...fill(250, 250, 250, 4)], 8)
    expect(p).toEqual(THEME_FALLBACK)
    // 混入一半有效色 → 取有效色
    const q = themeFromSamples([...fill(5, 5, 5, 4), ...fill(90, 130, 200, 8)], 12)
    expect(q.vizColors[0]).toBe('#5a82c8')
  })

  it('亮度派生：背景亮度显著低于主色（压暗生效）', () => {
    const p = themeFromSamples(fill(200, 160, 80, 9), 9)
    const lum = (hex: string): number => {
      const parts = hex.slice(1).match(/.{2}/g) ?? []
      const r = parseInt(parts[0] ?? '0', 16)
      const g = parseInt(parts[1] ?? '0', 16)
      const b = parseInt(parts[2] ?? '0', 16)
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    expect(lum(p.bg)).toBeLessThan(lum(p.vizColors[0]))
    expect(lum(p.vizColors[1])).toBeGreaterThan(lum(p.vizColors[0]))
  })
})
