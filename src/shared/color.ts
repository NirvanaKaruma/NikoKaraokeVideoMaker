/** 颜色工具：hex ↔ rgb、渐变取色、占位柱数据（供预览/导出共用） */

export function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace('#', '')
  if (h.length === 3)
    h = h
      .split('')
      .map((c) => c + c)
      .join('')
  const n = parseInt(h, 16)
  if (Number.isNaN(n) || h.length !== 6) return [255, 255, 255]
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function lerpColor(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a)
  const [r2, g2, b2] = hexToRgb(b)
  const k = Math.min(Math.max(t, 0), 1)
  const mix = (x: number, y: number): number => Math.round(x + (y - x) * k)
  return `rgb(${mix(r1, r2)}, ${mix(g1, g2)}, ${mix(b1, b2)})`
}

/** 按位置取色：单色恒返回；多色从左到右线性插值（渐变） */
export function colorAt(colors: string[], t: number): string {
  if (colors.length === 0) return '#ffffff'
  if (colors.length === 1) return colors[0]
  const seg = Math.min(Math.max(t, 0), 0.999999) * (colors.length - 1)
  const i = Math.floor(seg)
  return lerpColor(colors[i], colors[i + 1], seg - i)
}

/** M2 静态占位柱（确定性伪随机 0.15–1）；M3 起由真实频谱数据替换 */
export function placeholderBars(count: number): number[] {
  return Array.from({ length: count }, (_, i) => {
    const v = Math.abs(Math.sin(i * 12.9898 + 78.233) * 43758.5453) % 1
    return 0.15 + 0.85 * v
  })
}
