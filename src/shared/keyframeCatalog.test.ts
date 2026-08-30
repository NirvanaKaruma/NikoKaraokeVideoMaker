import { describe, expect, it } from 'vitest'
import {
  catalogDiagnostics,
  catalogEntry,
  currentValueAt,
  KEYFRAME_CATALOG
} from './keyframeCatalog'
import { DEFAULT_LAYOUT } from './layout'

describe('keyframeCatalog', () => {
  it('清单路径在 DEFAULT_LAYOUT 中真实存在且类型匹配', () => {
    const bad = catalogDiagnostics().filter((d) => !d.ok)
    expect(bad).toEqual([])
  })

  it('数值条目 min<max、颜色条目为 #rrggbb 样本', () => {
    for (const c of KEYFRAME_CATALOG) {
      if (c.kind === 'number') {
        expect(c.min).toBeLessThan(c.max)
        expect(c.step).toBeGreaterThan(0)
      }
    }
    const color = catalogEntry('texts.songTitle.style.color')
    expect(color?.kind).toBe('color')
    const v = currentValueAt(DEFAULT_LAYOUT, 'texts.songTitle.style.color')
    expect(typeof v).toBe('string')
  })

  it('currentValueAt 对不存在路径返回 undefined、对数值返回 number', () => {
    expect(currentValueAt(DEFAULT_LAYOUT, 'no.such.path')).toBeUndefined()
    expect(typeof currentValueAt(DEFAULT_LAYOUT, 'mainImage.rect.x')).toBe('number')
  })

  it('清单为 v1 完整清单（首版 24 条，后续版本向此扩展）', () => {
    expect(KEYFRAME_CATALOG.length).toBe(30)
  })

  it('节拍源条目：bpm/周期为可空数值（null = 关闭，诊断跳过类型检查）', () => {
    expect(catalogEntry('visualizer.bpm')?.kind).toBe('number')
    expect(catalogEntry('visualizer.bpm')?.nullable).toBe(true)
    expect(catalogEntry('visualizer.beatIntervalSec')?.nullable).toBe(true)
    expect(currentValueAt(DEFAULT_LAYOUT, 'visualizer.bpm')).toBeUndefined() // null 不捕获为帧值
  })

  it('音乐响应条目：脉冲/爆发/密度为数值、预设为选项类（4 个预设选项）', () => {
    expect(catalogEntry('beat.pulse')?.kind).toBe('number')
    expect(catalogEntry('beat.burst')?.kind).toBe('number')
    expect(catalogEntry('beat.particleDensity')?.kind).toBe('number')
    const preset = catalogEntry('beat.particlePreset')
    expect(preset?.kind).toBe('choice')
    expect(preset?.options).toHaveLength(4)
    expect(typeof currentValueAt(DEFAULT_LAYOUT, 'beat.particlePreset')).toBe('string')
  })
})
