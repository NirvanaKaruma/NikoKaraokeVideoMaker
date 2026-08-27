import { useCallback, useEffect, useSyncExternalStore } from 'react'
import {
  getLocale,
  setLocale as storeSetLocale,
  subscribeLocale,
  t,
  type Locale
} from '@shared/i18n'

/**
 * 界面语言 hook（i18n）：
 * - 启动时从 main 读取持久化偏好（默认 zh-cn）；
 * - 切换时写回 main（config.json）并即时重渲染（全局 store 订阅）；
 * - 返回 t()：所有界面文案经它取词（点路径 + 占位符）。
 */
export function useLocale(): {
  locale: Locale
  setLocale: (l: Locale) => void
  t: typeof t
} {
  const locale = useSyncExternalStore(subscribeLocale, getLocale)

  useEffect(() => {
    let cancelled = false
    void window.api.getLocale().then((v: string) => {
      if (cancelled) return
      if (v === 'zh-cn' || v === 'en' || v === 'jp') storeSetLocale(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const setLocale = useCallback((l: Locale) => {
    storeSetLocale(l)
    void window.api.setLocale(l)
  }, [])

  return { locale, setLocale, t }
}
