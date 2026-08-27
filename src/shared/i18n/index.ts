/**
 * 国际化运行时（核心约束：main 进程与 renderer 共用同一套资源与 store）。
 * - 资源文件：zh-cn.ts（完整）/ en.ts / jp.ts（骨架，空值回退中文）；
 * - t(key, params)：点路径取词，{xxx} 占位符替换；
 * - 语言偏好持久化：main 写 userData/config.json（app.locale），renderer 经 IPC 读写；
 * - Reactive：本模块作为 renderer 的全局 store（useSyncExternalStore），切换语言即时重渲染。
 */

import { en } from './en'
import { jp } from './jp'
import { zhCn } from './zh-cn'

export type Locale = 'zh-cn' | 'en' | 'jp'

export const SUPPORTED_LOCALES: { id: Locale; nativeName: string }[] = [
  { id: 'zh-cn', nativeName: '简体中文' },
  { id: 'en', nativeName: 'English' },
  { id: 'jp', nativeName: '日本語' }
]

export const DEFAULT_LOCALE: Locale = 'zh-cn'

const RESOURCES: Record<Locale, unknown> = {
  'zh-cn': zhCn,
  en,
  jp
}

/** 点路径取值（不含回退） */
function lookup(root: unknown, path: string[]): string | null {
  let node: unknown = root
  for (const seg of path) {
    if (node == null || typeof node !== 'object') return null
    node = (node as Record<string, unknown>)[seg]
  }
  return typeof node === 'string' ? node : null
}

let current: Locale = DEFAULT_LOCALE
const listeners = new Set<() => void>()

export function getLocale(): Locale {
  return current
}

export function setLocale(locale: Locale): void {
  if (locale === current || !RESOURCES[locale]) return
  current = locale
  for (const l of listeners) l()
}

export function subscribeLocale(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/**
 * 取词：优先当前语言；空值/缺失 → 回退 zh-cn；仍无则返回 key 本身（便于发现缺失键）。
 */
export function t(key: string, params?: Record<string, string | number | boolean>): string {
  const path = key.split('.')
  let text = lookup(RESOURCES[current], path)
  if (!text) text = lookup(RESOURCES[DEFAULT_LOCALE], path)
  if (!text) return key
  if (params) {
    text = text.replace(/\{(\w+)\}/g, (m, name: string) =>
      params[name] != null ? String(params[name]) : m
    )
  }
  return text
}
