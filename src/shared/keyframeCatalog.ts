/**
 * 关键帧可动画属性清单（1.0.0 T5）——v1 聚焦用户确认的清单：
 * 字号/位置/透明度/字号色/描边/辉光/Ken Burns/呼吸等数值与颜色类。
 * 路径全部对应 ProjectLayout 真实字段（单测用 DEFAULT_LAYOUT 逐一校验存在性+类型）。
 */
import { DEFAULT_LAYOUT, type ProjectLayout } from './layout'
import { getByPath } from './timeline'

export interface KeyframeCatalogEntry {
  /** 点路径，如 'texts.songTitle.style.fontSize'（overlay 动态条目：'overlayLayers.<i>.rect.x'） */
  path: string
  /** i18n label key（zh-cn 先行；en/jp 回退） */
  labelKey: string
  kind: 'number' | 'color' | 'choice'
  min: number
  max: number
  /** 数值步进（原始单位） */
  step: number
  /** 显示缩放：UI 显示值 = 实际值 × displayScale（如 fontSize 0.095 → 9.5） */
  displayScale?: number
  /** 动态条目（附加图层按索引生成）：标签 = 「图层 {idx+1} · 字段」 */
  dynamic?: boolean
  idx?: number
  /** 选项类条目（kind='choice'，如粒子预设）：下拉选项与标签 */
  options?: { value: string; labelKey: string }[]
}

const N = (
  path: string,
  labelKey: string,
  min: number,
  max: number,
  step: number,
  displayScale?: number
): KeyframeCatalogEntry => ({ path, labelKey, kind: 'number', min, max, step, displayScale })
const C = (path: string, labelKey: string): KeyframeCatalogEntry => ({
  path,
  labelKey,
  kind: 'color',
  min: 0,
  max: 1,
  step: 1
})
const CHOICE = (
  path: string,
  labelKey: string,
  options: { value: string; labelKey: string }[]
): KeyframeCatalogEntry => ({ path, labelKey, kind: 'choice', min: 0, max: 1, step: 1, options })

export const KEYFRAME_CATALOG: KeyframeCatalogEntry[] = [
  // 文本样式（歌名/作者）
  N('texts.songTitle.style.fontSize', 'kf.songTitleFont', 0.015, 0.5, 0.001, 100),
  N('texts.artist.style.fontSize', 'kf.artistFont', 0.01, 0.3, 0.001, 100),
  C('texts.songTitle.style.color', 'kf.songTitleColor'),
  C('texts.songTitle.style.strokeColor', 'kf.songTitleStrokeColor'),
  N('texts.songTitle.style.strokeWidth', 'kf.songTitleStrokeWidth', 0, 0.06, 0.001, 100),
  C('texts.songTitle.style.glowColor', 'kf.songTitleGlowColor'),
  N('texts.songTitle.style.glowBlur', 'kf.songTitleGlowBlur', 0, 0.06, 0.001, 100),
  // 文本位置
  N('texts.songTitle.rect.x', 'kf.songTitleX', 0, 1, 0.001, 100),
  N('texts.songTitle.rect.y', 'kf.songTitleY', 0, 1, 0.001, 100),
  N('texts.artist.rect.x', 'kf.artistX', 0, 1, 0.001, 100),
  N('texts.artist.rect.y', 'kf.artistY', 0, 1, 0.001, 100),
  // 主图：位置/呼吸/旋转/辉光脉动
  N('mainImage.rect.x', 'kf.mainX', 0, 1, 0.001, 100),
  N('mainImage.rect.y', 'kf.mainY', 0, 1, 0.001, 100),
  N('mainImage.rect.w', 'kf.mainW', 0.02, 1, 0.001, 100),
  N('mainImage.rect.h', 'kf.mainH', 0.02, 1, 0.001, 100),
  N('mainImage.fx.breathe', 'kf.mainBreathe', 0, 1, 0.01, 100),
  N('mainImage.fx.rotateDeg', 'kf.mainRotate', -45, 45, 0.5),
  N('mainImage.fx.glowPulse', 'kf.mainGlowPulse', 0, 1, 0.01, 100),
  // 背景：模糊/压暗/Ken Burns
  N('background.blur', 'kf.bgBlur', 0, 100, 0.5),
  N('background.dimOpacity', 'kf.bgDim', 0, 1, 0.01, 100),
  N('background.fx.kenBurns', 'kf.bgKenBurns', 0, 0.4, 0.001, 100),
  // 可视化：位置/高度（频谱能量律动是天然的动画源，位置/高度关键帧用于场景编排）
  N('visualizer.rect.y', 'kf.vizY', 0, 1, 0.001, 100),
  N('visualizer.rect.h', 'kf.vizH', 0.02, 1, 0.001, 100),
  N('visualizer.heightRatio', 'kf.vizHeightRatio', 0.1, 1, 0.01, 100),
  // 音乐响应（0.6.0 节拍特效：脉冲/粒子强度与预设——特效同样可按关键帧编排）
  N('beat.pulse', 'kf.beatPulse', 0, 1, 0.01, 100),
  N('beat.burst', 'kf.beatBurst', 0, 1, 0.01, 100),
  N('beat.particleDensity', 'kf.beatDensity', 0, 1, 0.01, 100),
  CHOICE('beat.particlePreset', 'kf.beatPreset', [
    { value: 'snow', labelKey: 'fx.beat.presetSnow' },
    { value: 'sakura', labelKey: 'fx.beat.presetSakura' },
    { value: 'star', labelKey: 'fx.beat.presetStar' },
    { value: 'bubble', labelKey: 'fx.beat.presetBubble' }
  ])
  // 附加层/作者颜色等留后续版本扩展（先保证 v1 清单可测可维护）
]

/** 按路径查目录项（无则 null） */
export function catalogEntry(path: string): KeyframeCatalogEntry | null {
  return KEYFRAME_CATALOG.find((c) => c.path === path) ?? null
}

/** 当前编辑视图取该路径值（用于「添加关键帧」捕获当前面板值；不存在返回 undefined） */
export function currentValueAt(view: ProjectLayout, path: string): number | string | undefined {
  const v = getByPath(view, path)
  if (typeof v === 'number' || typeof v === 'string') return v
  return undefined
}

/** 单测/自检：清单路径在 DEFAULT_LAYOUT 中真实存在且类型匹配 */
export function catalogDiagnostics(): {
  path: string
  ok: boolean
  kind: string
  actual: string
}[] {
  return KEYFRAME_CATALOG.map((c) => {
    const v = getByPath(DEFAULT_LAYOUT, c.path)
    const actual = typeof v
    // number 条目必须为 number；color/choice 条目必须为字符串（#rrggbb / 预设 id）
    const ok = c.kind === 'number' ? actual === 'number' : actual === 'string'
    return { path: c.path, ok, kind: c.kind, actual }
  })
}

/**
 * 收集当前视图全部可关键帧路径（静态目录 + 附加图层动态索引路径）。
 * PR 式面板 auto-keyframe 路由用：commit 差异在这些路径上比对，决定"写帧"还是"写基准"。
 */
export function collectKeyframePaths(view: ProjectLayout): string[] {
  const paths = KEYFRAME_CATALOG.map((c) => c.path)
  for (let i = 0; i < (view.overlayLayers ?? []).length; i++) {
    const b = 'overlayLayers.' + i + '.'
    paths.push(
      b + 'rect.x',
      b + 'rect.y',
      b + 'rect.w',
      b + 'rect.h',
      b + 'opacity',
      b + 'fx.breathe',
      b + 'fx.rotateDeg',
      b + 'fx.glowPulse'
    )
  }
  return paths
}

/** 首个发生变化的可关键帧路径（PR 式路由用；无变化返回 null） */
export function firstChangedKeyframePath(
  base: ProjectLayout,
  next: ProjectLayout,
  paths: string[]
): string | null {
  for (const p of paths) {
    const a = getByPath(base, p)
    const b = getByPath(next, p)
    if (a !== b) return p
  }
  return null
}
