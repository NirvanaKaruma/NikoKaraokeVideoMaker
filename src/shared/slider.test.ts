import { describe, expect, it } from 'vitest'
import { formatSliderValue, nudgeSliderValue, parseSliderInput } from './slider'

describe('slider 数字框 helpers（0.9.0 数值精调）', () => {
  it('格式化：百分比 ×100，小数位由步进决定', () => {
    expect(formatSliderValue(0.42, 100, 0.01)).toBe('42') // 步进 1%（×100）→ 0 位小数
    expect(formatSliderValue(0.5, 100, 0.01)).toBe('50')
    expect(formatSliderValue(0.5, 100, 0.05)).toBe('50') // 步进 5%（0.05×100=5）→ 整数显示；细步进才有小数（见 border 0.0005）
    expect(formatSliderValue(1.2, 1, 0.1)).toBe('1.2')
    expect(formatSliderValue(1.234, 1, 0.5)).toBe('1.2')
  })

  it('解析：显示单位 → 模型值（÷unitScale），钳制 [min,max]；非法 null', () => {
    expect(parseSliderInput('42', 100, 0, 1)).toBeCloseTo(0.42, 9)
    expect(parseSliderInput('150', 100, 0, 1)).toBe(1) // 超上限钳制
    expect(parseSliderInput('-5', 100, 0, 1)).toBe(0)
    expect(parseSliderInput('abc', 100, 0, 1)).toBeNull()
  })

  it('键盘微调：显示单位 ± n×step（×100 面、×10 微调由调用方传 times）', () => {
    expect(nudgeSliderValue(0.42, 100, 0.01, 1)).toBeCloseTo(0.43, 9)
    expect(nudgeSliderValue(0.42, 100, 0.01, 10)).toBeCloseTo(0.52, 9)
    expect(nudgeSliderValue(1.2, 1, 0.1, -1)).toBeCloseTo(1.1, 9)
  })

  it('确定性：同输入同输出', () => {
    expect(formatSliderValue(0.42, 100, 0.01)).toBe(formatSliderValue(0.42, 100, 0.01))
  })
})
