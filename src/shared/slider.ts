/**
 * 数值精调（0.9.0）：滑块数字框的纯格式化/解析（可单测）。
 * 显示值 = 模型值 × unitScale（百分比×100、秒/度/毫秒用 1）；
 * 提交：输入 ÷ unitScale → 钳制 [min, max]。
 */

/** 显示小数位：由步进决定（step×unitScale 的小数位，上限 4） */
export function formatSliderValue(model: number, unitScale: number, step: number): string {
  const shown = model * unitScale
  const shownStep = Math.max(0.0001, step * unitScale)
  const decimals = Math.min(4, Math.max(0, Math.ceil(-Math.log10(shownStep))))
  return shown.toFixed(decimals)
}

/** 解析输入（显示单位 → 模型值，钳制 [min,max]）；非法返回 null */
export function parseSliderInput(
  text: string,
  unitScale: number,
  min: number,
  max: number
): number | null {
  const n = Number(text)
  if (!Number.isFinite(n)) return null
  const model = n / unitScale
  return Math.min(Math.max(model, min), max)
}

/** 键盘微调：当前显示值 ± n×step（单位=显示单位） */
export function nudgeSliderValue(
  model: number,
  unitScale: number,
  step: number,
  times: number
): number {
  const shown = model * unitScale + times * step * unitScale
  return shown / unitScale
}
