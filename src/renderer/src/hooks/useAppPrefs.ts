import { useCallback, useEffect, useRef, useState } from 'react'
import {
  DEFAULT_PREFS,
  eventToShortcut,
  matchesShortcut,
  normalizePrefs,
  type AppPrefs,
  type KeyboardEventLike,
  type ShortcutAction
} from '@shared/appSettings'

/**
 * 应用级偏好（1.0.0 设置窗口重构）——main config.json 持久化；
 * theme/previewVolume/autoSave/shortcuts 统一在此读改写回。
 * 返回 prefs + setPrefs（patch 合并）+ 每次写入即落盘。
 */
export function useAppPrefs(): {
  prefs: AppPrefs
  ready: boolean
  setPrefs: (patch: Partial<AppPrefs>) => Promise<void>
  /** 快捷键命中测试：当前绑定下 e 是否触发 action */
  matchAction: (e: KeyboardEventLike, action: ShortcutAction) => boolean
  /** 设置窗口录键用：事件 → 规范串 */
  recordSeq: (e: KeyboardEventLike) => string | null
} {
  const [prefs, setPrefsState] = useState<AppPrefs>(DEFAULT_PREFS)
  const [ready, setReady] = useState(false)
  const prefsRef = useRef<AppPrefs>(DEFAULT_PREFS)
  useEffect(() => {
    prefsRef.current = prefs
  }, [prefs])

  useEffect(() => {
    let alive = true
    void window.api.appPrefs.get().then((p) => {
      if (!alive) return
      setPrefsState(normalizePrefs(p))
      setReady(true)
    })
    return () => {
      alive = false
    }
  }, [])

  const setPrefs = useCallback(async (patch: Partial<AppPrefs>): Promise<void> => {
    const next = normalizePrefs({ ...prefsRef.current, ...patch })
    setPrefsState(next)
    try {
      await window.api.appPrefs.set(next)
    } catch {
      // 落盘失败不阻塞 UI（下次写入重试）
    }
  }, [])

  const matchAction = useCallback((e: KeyboardEventLike, action: ShortcutAction): boolean => {
    return matchesShortcut(e, prefsRef.current.shortcuts[action])
  }, [])

  const recordSeq = useCallback((e: KeyboardEventLike): string | null => {
    // 纯修饰键不记录（等下一个实质键）
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null
    return eventToShortcut(e)
  }, [])

  return { prefs, ready, setPrefs, matchAction, recordSeq }
}
