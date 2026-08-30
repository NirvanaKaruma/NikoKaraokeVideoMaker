/**
 * 应用级设置（1.0.0 设置窗口重构）——与工程布局/导出配置无关，主题、预览音量、
 * 自动保存、快捷键等系统偏好。持久化在 main 侧 config.json（AppConfig.prefs）。
 *
 * 设计（参考 KTV 打轴工具设置页）：设置窗口 = 一级 Tab（常规/自动保存/快捷键/导出/关于），
 * 每页垂直分组行（名称 + 描述 + 控件）；快捷键全部可改绑。
 */

/** 快捷键动作——编辑器级操作（应用级只读）；可改绑 */
export type ShortcutAction =
  | 'togglePlay' // 播放/暂停（空格——剪辑/打轴软件通用语义）
  | 'stopPlay' // 停止（回到时间轴开头）
  | 'undo'
  | 'redo'
  | 'saveProject'
  | 'exportVideo'

export type ShortcutMap = Record<ShortcutAction, string>

/** 新版设置偏好（全部可持久化） */
export interface AppPrefs {
  /** 界面主题 */
  theme: 'dark' | 'light'
  /** 预览音量（0–1，仅影响预览扬声器输出；导出音频、频谱分析不受影响） */
  previewVolume: number
  /** 自动保存：开关 + 间隔（分钟） */
  autoSave: { enabled: boolean; intervalMin: number }
  /** 快捷键绑定（key = action；值 = 规范组合串，如 'Space' / 'Ctrl+Z' / 'Ctrl+Shift+Z'） */
  shortcuts: ShortcutMap
  /** 导出默认分辨率 id（对应 RESOLUTIONS[].id；空 = 跟随工程） */
  defaultExportResolution: string
}

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  togglePlay: 'Space',
  stopPlay: 'Ctrl+.',
  undo: 'Ctrl+Z',
  redo: 'Ctrl+Shift+Z',
  saveProject: 'Ctrl+S',
  exportVideo: 'Ctrl+E'
}

export const DEFAULT_PREFS: AppPrefs = {
  theme: 'dark',
  previewVolume: 0.8,
  autoSave: { enabled: false, intervalMin: 5 },
  shortcuts: { ...DEFAULT_SHORTCUTS },
  defaultExportResolution: ''
}

/** 归一化：合并默认值（旧 config.json 无 prefs 字段时全量回退） */
export function normalizePrefs(p: Partial<AppPrefs> | null | undefined): AppPrefs {
  const src = p ?? {}
  return {
    theme: src.theme === 'light' ? 'light' : 'dark',
    previewVolume: clamp01(src.previewVolume ?? DEFAULT_PREFS.previewVolume),
    autoSave: {
      enabled: src.autoSave?.enabled ?? false,
      intervalMin: Math.min(60, Math.max(1, src.autoSave?.intervalMin ?? 5))
    },
    shortcuts: {
      togglePlay: normalizeSeq(src.shortcuts?.togglePlay, DEFAULT_SHORTCUTS.togglePlay),
      stopPlay: normalizeSeq(src.shortcuts?.stopPlay, DEFAULT_SHORTCUTS.stopPlay),
      undo: normalizeSeq(src.shortcuts?.undo, DEFAULT_SHORTCUTS.undo),
      redo: normalizeSeq(src.shortcuts?.redo, DEFAULT_SHORTCUTS.redo),
      saveProject: normalizeSeq(src.shortcuts?.saveProject, DEFAULT_SHORTCUTS.saveProject),
      exportVideo: normalizeSeq(src.shortcuts?.exportVideo, DEFAULT_SHORTCUTS.exportVideo)
    },
    defaultExportResolution: src.defaultExportResolution ?? ''
  }
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, Number.isFinite(v) ? v : DEFAULT_PREFS.previewVolume))
}

/** 组合串合法性：非空且可解析（简单的白名单校验，防止空绑定） */
function normalizeSeq(v: string | undefined, fallback: string): string {
  if (typeof v !== 'string' || v.trim() === '') return fallback
  // 寄生空格清理：'Ctrl + Shift + Z' → 'Ctrl+Shift+Z'
  return v
    .replace(/\s*\+\s*/g, '+')
    .split('+')
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .join('+')
}

/**
 * 规范组合串 → 键盘事件匹配（大小写不敏感 key；Modifier 必须精确匹配：指定必按、未指定必不按）。
 * Space/箭头等取 e.code 兜底（e.key 在不同键盘布局下不稳定）。
 */
export function matchesShortcut(e: KeyboardEventLike, seq: string): boolean {
  const parts = seq.split('+').map((s) => s.trim().toLowerCase())
  const has = (m: string): boolean => parts.includes(m)
  const modOk =
    !!e.ctrlKey === has('ctrl') &&
    !!e.metaKey === has('meta') &&
    !!e.shiftKey === has('shift') &&
    !!e.altKey === has('alt')
  if (!modOk) return false
  const key = parts[parts.length - 1]
  if (key === '') return false
  const actual = (e.key || e.code || '').toLowerCase()
  if (key === 'space') return actual === ' ' || e.code === 'Space'
  if (key === 'enter') return actual === 'enter' || e.code === 'Enter'
  if (key.startsWith('arrow')) return actual === key || (e.code ?? '').toLowerCase() === key
  return actual === key
}

/** KeyboardEventLike：window keydown 传入足够字段（测试可用 stub） */
export interface KeyboardEventLike {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
}

/** 把键盘事件转成规范组合串（记录用；无修饰键时为 'KeyX'/'Space' 等 code） */
export function eventToShortcut(e: KeyboardEventLike): string | null {
  const mods: string[] = []
  if (e.ctrlKey) mods.push('Ctrl')
  if (e.metaKey) mods.push('Meta')
  if (e.shiftKey) mods.push('Shift')
  if (e.altKey) mods.push('Alt')
  let key = ''
  const code = e.code ?? ''
  if (code === 'Space') key = 'Space'
  else if (/^Key[A-Z]$/.test(code)) key = code.slice(3)
  else if (/^Digit[0-9]$/.test(code)) key = code.slice(5)
  else if (/^Arrow/.test(code)) key = code
  else if (e.key && e.key.length === 1) key = e.key.toUpperCase()
  else if (e.key === 'Enter' || code === 'Enter') key = 'Enter'
  else if (code === 'Escape') key = 'Escape'
  else return null
  return [...mods, key].join('+')
}

/** 人读展示：'Space' → '␣'（免翻译通用符号键名） */
export function prettyShortcut(seq: string): string {
  return seq
    .split('+')
    .map((s) => (s === 'Space' ? '␣' : s))
    .join('+')
}
