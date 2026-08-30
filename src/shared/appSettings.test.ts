import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SHORTCUTS,
  eventToShortcut,
  matchesShortcut,
  normalizePrefs,
  prettyShortcut,
  type KeyboardEventLike
} from './appSettings'

const ev = (p: Partial<KeyboardEventLike> & { key: string }): KeyboardEventLike => ({
  key: p.key,
  code: p.code,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  ...p
})

describe('appSettings 快捷键匹配', () => {
  it('空格 = 播放/暂停（无修饰键；e.key=空格或 code=Space 都命中）', () => {
    expect(matchesShortcut(ev({ key: ' ', code: 'Space' }), 'Space')).toBe(true)
    expect(matchesShortcut(ev({ key: 'Space', code: 'Space' }), 'Space')).toBe(true)
    expect(matchesShortcut(ev({ key: ' ', code: 'Space', ctrlKey: true }), 'Space')).toBe(false)
    expect(matchesShortcut(ev({ key: 'a' }), 'Space')).toBe(false)
  })

  it('Ctrl+Z 精确匹配修饰键（无 Ctrl 不命中；Shift 额外不命中）', () => {
    const z = ev({ key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(matchesShortcut(z, 'Ctrl+Z')).toBe(true)
    expect(matchesShortcut(z, 'Ctrl+Y')).toBe(false)
    expect(matchesShortcut(ev({ key: 'z', code: 'KeyZ' }), 'Ctrl+Z')).toBe(false)
    expect(
      matchesShortcut(ev({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true }), 'Ctrl+Z')
    ).toBe(false)
    expect(matchesShortcut(ev({ key: 'Z', code: 'KeyZ', ctrlKey: true }), 'Ctrl+Z')).toBe(true)
    // Meta 不匹配 Ctrl
    expect(matchesShortcut(ev({ key: 'z', code: 'KeyZ', metaKey: true }), 'Ctrl+Z')).toBe(false)
  })

  it('Ctrl+Shift+Z 双修饰', () => {
    const e = ev({ key: 'z', code: 'KeyZ', ctrlKey: true, shiftKey: true })
    expect(matchesShortcut(e, 'Ctrl+Shift+Z')).toBe(true)
    expect(matchesShortcut(e, 'Ctrl+Z')).toBe(false)
  })

  it('箭头与 Enter 走 code 兜底', () => {
    expect(matchesShortcut(ev({ key: 'Left', code: 'ArrowLeft' }), 'ArrowLeft')).toBe(true)
    expect(matchesShortcut(ev({ key: 'Enter', code: 'Enter' }), 'Enter')).toBe(true)
  })

  it('eventToShortcut 记录/绑定（空格与字母键 → code；Modifier 集合）', () => {
    expect(eventToShortcut(ev({ key: ' ', code: 'Space' }))).toBe('Space')
    expect(eventToShortcut(ev({ key: 'z', code: 'KeyZ', ctrlKey: true }))).toBe('Ctrl+Z')
    expect(eventToShortcut(ev({ key: 'F', code: 'KeyF', ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+F'
    )
    expect(eventToShortcut(ev({ key: 'ArrowRight', code: 'ArrowRight' }))).toBe('ArrowRight')
  })

  it('normalizePrefs 合并默认值（旧文件无 prefs / 字段缺失 / 越界）', () => {
    const p = normalizePrefs(null)
    expect(p.theme).toBe('dark')
    expect(p.previewVolume).toBe(0.8)
    expect(p.autoSave).toEqual({ enabled: false, intervalMin: 5 })
    expect(p.shortcuts).toEqual(DEFAULT_SHORTCUTS)
    // 部分字段 + 越界钳制
    const q = normalizePrefs({
      theme: 'light' as never,
      previewVolume: 9,
      autoSave: { enabled: true, intervalMin: 999 },
      shortcuts: { togglePlay: ' Ctrl + P ' } as never
    })
    expect(q.theme).toBe('light')
    expect(q.previewVolume).toBe(1)
    expect(q.autoSave.intervalMin).toBe(60)
    expect(q.shortcuts.togglePlay).toBe('Ctrl+P')
  })

  it('prettyShortcut 空格显示为通用符号', () => {
    expect(prettyShortcut('Space')).toBe('␣')
    expect(prettyShortcut('Ctrl+Shift+Z')).toBe('Ctrl+Shift+Z')
  })
})
