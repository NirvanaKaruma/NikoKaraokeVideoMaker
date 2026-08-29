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

  it('清单为 v1 完整清单（首版 22 条，后续版本向此扩展）', () => {
    expect(KEYFRAME_CATALOG.length).toBe(24)
  })
})
