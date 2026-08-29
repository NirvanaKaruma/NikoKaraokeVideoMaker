/**
 * 自动主题色（0.8.0）：纯函数（可单测、确定性）。
 * 输入：降采样后的像素样本（扁平 RGB 三元组数组，renderer 侧把封面画进 32×32 画布取 getImageData）。
 * 算法：每通道量化到 16 级 → 频次桶统计（抗噪）→ 排除过暗/过曝（亮度 <35 或 >235）→ 最高频桶均值 = 主色
 * → 派生：背景基色（主色 82% 亮度）与可视化渐变双色（主色 + 高频桶的亮色变体）。
 */

export interface ThemePalette {
  /** 背景基色 #rrggbb（纯色底/透明封面合成基色） */
  bg: string
  /** 可视化渐变双色（[主色, 亮色变体]） */
  vizColors: [string, string]
}

export const THEME_FALLBACK: ThemePalette = {
  bg: '#4a4f5a',
  vizColors: ['#ff5f9e', '#7ce3ff']
}

function toHex(v: number): string {
  const c = Math.min(255, Math.max(0, Math.round(v))).toString(16)
  return c.length < 2 ? '0' + c : c
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + toHex(r) + toHex(g) + toHex(b)
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6
  else if (max === gn) h = ((bn - rn) / d + 2) / 6
  else h = ((rn - gn) / d + 4) / 6
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255)
    return [v, v, v]
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t: number): number => {
    let tt = t
    if (tt < 0) tt += 1
    if (tt > 1) tt -= 1
    if (tt < 1 / 6) return p + (q - p) * 6 * tt
    if (tt < 1 / 2) return q
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
    return p
  }
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)]
}

function adjustLightness(r: number, g: number, b: number, dl: number): [number, number, number] {
  const [h, s, l] = rgbToHsl(r, g, b)
  return hslToRgb(h, s, Math.min(1, Math.max(0, l + dl)))
}

/**
 * 提取主题色（确定性）：samples 为扁平 RGB（每像素 3 个数，长度 = pixelCount × 3）。
 * 全被过滤（纯黑/纯白图）→ 回退默认主题。
 */
export function themeFromSamples(samples: ArrayLike<number>, pixelCount: number): ThemePalette {
  const n = Math.max(1, pixelCount)
  // 每通道量化 16 级 → 桶 key（抗噪：相近色合并）
  const buckets = new Map<number, { count: number; r: number; g: number; b: number }>()
  for (let i = 0; i < n; i++) {
    const r = (samples[i * 3] ?? 0) as number
    const g = (samples[i * 3 + 1] ?? 0) as number
    const b = (samples[i * 3 + 2] ?? 0) as number
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
    if (luma < 35 || luma > 235) continue // 过暗/过曝排除
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4)
    const bkt = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 }
    bkt.count++
    bkt.r += r
    bkt.g += g
    bkt.b += b
    buckets.set(key, bkt)
  }
  if (buckets.size === 0) return { ...THEME_FALLBACK, vizColors: [...THEME_FALLBACK.vizColors] }
  let best: { count: number; r: number; g: number; b: number } | null = null
  for (const bkt of buckets.values()) {
    if (!best || bkt.count > best.count) best = bkt
  }
  const main = best as { count: number; r: number; g: number; b: number }
  const r0 = main.r / main.count
  const g0 = main.g / main.count
  const b0 = main.b / main.count
  // 背景基色 = 主色 -0.18 亮度（压暗一档，叠模糊/压暗后观感统一）
  const bgRgb = adjustLightness(r0, g0, b0, -0.18)
  // 可视化渐变：[主色, 亮 +0.25 变体]
  const lightRgb = adjustLightness(r0, g0, b0, 0.25)
  return {
    bg: rgbToHex(bgRgb[0], bgRgb[1], bgRgb[2]),
    vizColors: [rgbToHex(r0, g0, b0), rgbToHex(lightRgb[0], lightRgb[1], lightRgb[2])]
  }
}
