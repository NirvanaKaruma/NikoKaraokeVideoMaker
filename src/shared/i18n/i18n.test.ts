import { describe, expect, it } from 'vitest'
import { getLocale, setLocale, subscribeLocale, t } from './index'
import { en } from './en'
import { jp } from './jp'
import { zhCn } from './zh-cn'

/** 校验 en/jp 与 zh-cn 键结构同构（同遍历） */
function sameShape(a: unknown, b: unknown, path = ''): string[] {
  const diffs: string[] = []
  if (typeof a !== typeof b) {
    if (!(typeof a === 'string' && typeof b === 'string')) diffs.push(path || '(root)')
    return diffs
  }
  if (a && typeof a === 'object') {
    const ka = Object.keys(a as Record<string, unknown>)
    const kb = Object.keys(b as Record<string, unknown>)
    for (const k of new Set([...ka, ...kb])) {
      if (!(k in (a as Record<string, unknown>))) diffs.push(path + '.' + k + ' (缺于 a)')
      else if (!(k in (b as Record<string, unknown>))) diffs.push(path + '.' + k + ' (缺于 b)')
      else diffs.push(...sameShape((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], path + '.' + k))
    }
  }
  return diffs
}

describe('i18n', () => {
  it('en/jp 与 zh-cn 键结构同构（缺少/多余键会被发现）', () => {
    expect(sameShape(zhCn, en)).toEqual([])
    expect(sameShape(zhCn, jp)).toEqual([])
  })

  it('默认 zh-cn；t 返回中文', () => {
    expect(getLocale()).toBe('zh-cn')
    expect(t('header.saveProject')).toBe('💾 保存项目')
  })

  it('en 空值回退 zh-cn；已填值直接返回', () => {
    setLocale('en')
    expect(t('header.saveProject')).toBe('💾 保存项目') // en 未填 → 回退
    setLocale('zh-cn')
  })

  it('占位符替换：参数注入 {v}/{min}/{max}', () => {
    expect(t('visualizer.barCount', { v: 128 })).toBe('柱数：128（100–160）')
    expect(t('visualizer.freqRange', { min: 30, max: 8000 })).toBe(
      '显示频率范围：30–8000 Hz'
    )
  })

  it('未知键返回 key 本身（便于发现缺失）', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('setLocale 触发订阅；无效语言忽略', () => {
    let fired = 0
    const off = subscribeLocale(() => fired++)
    setLocale('jp')
    expect(fired).toBe(1)
    // 重置回 zh-cn 不影响测试隔离
    setLocale('zh-cn')
    off()
    expect(fired).toBe(2)
  })
})
