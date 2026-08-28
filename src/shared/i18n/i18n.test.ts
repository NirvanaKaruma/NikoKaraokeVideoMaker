import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'
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
      else
        diffs.push(
          ...sameShape(
            (a as Record<string, unknown>)[k],
            (b as Record<string, unknown>)[k],
            path + '.' + k
          )
        )
    }
  }
  return diffs
}

/** 收集源码内所有 t('key') / t("key") 调用键（排除本测试与 en/jp 资源文件） */
function collectUsedKeys(): Set<string> {
  const used = new Set<string>()
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        if (p.includes('node_modules') || p.includes('dist') || p.includes('out')) continue
        walk(p)
        continue
      }
      if (!/\.(ts|tsx)$/.test(name)) continue
      if (p.endsWith('i18n.test.ts')) continue
      const text = readFileSync(p, 'utf-8')
      // 单双引号均可：t('key') 或 t("key")
      for (const m of text.matchAll(/\bt\((['"])([a-zA-Z0-9.]+)\1/g)) used.add(m[2])
    }
  }
  walk(join(__dirname, '../../..'))
  return used
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

  it('语言切换：已填值取该语言；未填键回退 zh-cn', () => {
    setLocale('en')
    // 自适应：en 已填 → 期望等于 en 值；未填 → 回退 zh-cn
    const enExpected = en.header.saveProject || zhCn.header.saveProject
    expect(t('header.saveProject')).toBe(enExpected)
    setLocale('zh-cn')
    expect(t('header.saveProject')).toBe(zhCn.header.saveProject)
  })

  it('占位符替换：参数注入 {v}/{min}/{max}', () => {
    setLocale('zh-cn')
    expect(t('visualizer.barCount', { v: 128 })).toBe('柱数：128（100–160）')
    expect(t('visualizer.freqRange', { min: 30, max: 8000 })).toBe('显示频率范围：30–8000 Hz')
  })

  it('未知键返回 key 本身（便于发现缺失）', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('源码中使用的全部 t(key) 均存在（防"爆键"回归）', () => {
    setLocale('zh-cn')
    const used = collectUsedKeys()
    expect(used.size).toBeGreaterThan(0)
    const missing: string[] = []
    for (const k of used) {
      if (t(k) === k) missing.push(k) // t 返回 key 本身 = 资源缺失
    }
    expect(missing).toEqual([])
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
