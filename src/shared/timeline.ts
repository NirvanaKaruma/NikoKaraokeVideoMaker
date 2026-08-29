/**
 * 时间轴与多场景（1.0.0）：纯函数数据模型 + 插值引擎（可单测、零 DOM 依赖）。
 *
 * 模型（用户确认：场景片段 + 片段内关键帧；继承式全局基线=一改即拆）：
 * - 片段（Segment）= 完整布局快照（layout 为 null 时继承全局基线，CoW 语义在 useProject 侧）；
 * - 关键帧轨道（PropertyTrack）= 属性路径 → 关键帧数组（t 相对片段起点，绝对秒）；
 * - 插值引擎：tSec → 片段 → base 布局 → 各轨道逐帧插值（数值 lerp / #rrggbb 颜色通道插值）
 *   → resolveLayoutAt 返回新 ProjectLayout（预览/导出共用同一函数 = 核心约束 A 延伸）。
 *
 * 缓动函数注入（开闭原则）：复用 fx.ts 的缓动族；新缓动只需加映射。
 */

import type { ProjectLayout } from './layout'
import { bounceIn, easeInOutQuad, easeOutCubic } from './fx'

export type EasingName = 'linear' | 'easeInOutQuad' | 'easeOutCubic' | 'bounce'

/** 关键帧值：数值（尺寸/位置/透明度/角度…）或颜色（#rrggbb） */
export type KeyframeValue = number | string

export interface Keyframe {
  /** 秒（相对片段起点，0 ≤ t ≤ 片段时长） */
  t: number
  value: KeyframeValue
  easing: EasingName
}

export interface PropertyTrack {
  /** 点路径，如 'texts.songTitle.style.fontSize'（layout 对象导航；数值/颜色字段） */
  path: string
  frames: Keyframe[]
}

export interface TimelineSegment {
  id: string
  /** 绝对秒 */
  startSec: number
  /** 绝对秒（> startSec） */
  endSec: number
  /** 布局快照；null = 继承全局基线（未拆分） */
  layout: ProjectLayout | null
  keyframes: PropertyTrack[]
}

export interface TimelineDocument {
  segments: TimelineSegment[]
}

/** 时间轴存在判定（导出/预览接入用：有片段 → 逐帧 resolve） */
export function hasTimeline(layout: ProjectLayout): boolean {
  return (layout.timeline?.segments ?? []).length > 0
}

/** 缓动函数表（注入点：新增缓动只改这里）；导出供关键帧编辑器下拉复用 */
export const EASINGS: Record<EasingName, (x: number) => number> = {
  linear: (x) => x,
  easeInOutQuad,
  easeOutCubic,
  bounce: bounceIn
}

/** 点路径导航：读（不存在返回 undefined） */
export function getByPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc == null) return undefined
    return (acc as Record<string, unknown>)[key]
  }, obj)
}

/** 点路径写入：中间节点不存在则创建（仅对象层）；返回 true=写过 */
export function setByPath(obj: Record<string, unknown>, path: string, value: unknown): boolean {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i]
    const next = cur[k]
    if (next == null || typeof next !== 'object') cur[k] = {}
    cur = cur[k] as Record<string, unknown>
  }
  cur[parts[parts.length - 1]] = value
  return true
}

/** 数值/颜色插值（颜色：#rrggbb 按通道 lerp → 取整；其他字符串不做插值=切换） */
export function interpolateValue(a: KeyframeValue, b: KeyframeValue, p: number): KeyframeValue {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p
  if (typeof a === 'string' && typeof b === 'string') {
    if (isHexColor(a) && isHexColor(b)) return lerpHex(a, b, p)
    return p < 0.5 ? a : b
  }
  return p < 0.5 ? a : b
}

function isHexColor(s: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(s)
}

function lerpHex(a: string, b: string, p: number): string {
  const pa = [parseInt(a.slice(1, 3), 16), parseInt(a.slice(3, 5), 16), parseInt(a.slice(5, 7), 16)]
  const pb = [parseInt(b.slice(1, 3), 16), parseInt(b.slice(3, 5), 16), parseInt(b.slice(5, 7), 16)]
  const hex = (v: number): string => {
    const c = Math.min(255, Math.max(0, Math.round(v))).toString(16)
    return c.length < 2 ? '0' + c : c
  }
  return (
    '#' +
    hex(pa[0] + (pb[0] - pa[0]) * p) +
    hex(pa[1] + (pb[1] - pa[1]) * p) +
    hex(pa[2] + (pb[2] - pa[2]) * p)
  )
}

/** 轨道在 tSec 的值：帧排序后按区间插值；首帧前/末帧后=clamp（剪辑/动画惯例：保持最近值） */
export function trackValueAt(track: PropertyTrack, tSec: number): KeyframeValue | null {
  if (track.frames.length === 0) return null
  const frames = [...track.frames].sort((x, y) => x.t - y.t)
  if (tSec <= frames[0].t) return frames[0].value
  const last = frames[frames.length - 1]
  if (tSec >= last.t) return last.value
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i]
    const f1 = frames[i + 1]
    if (tSec >= f0.t && tSec < f1.t) {
      const span = f1.t - f0.t
      const p = span <= 0 ? 1 : (tSec - f0.t) / span
      const eased = EASINGS[f0.easing]?.(p) ?? p
      return interpolateValue(f0.value, f1.value, eased)
    }
  }
  return last.value
}

/** 所在片段（首个包含 tSec 的；无则 null）——硬切语义：重叠时排序在前（更早 startSec）者生效 */
export function segmentAt(doc: TimelineDocument, tSec: number): TimelineSegment | null {
  return doc.segments.find((s) => tSec >= s.startSec && tSec < s.endSec) ?? null
}

/** 重叠校验（1.0.0 T9，非破坏）：返回重叠片段 id 对；[a,b) 半开区间——恰好相接不算重叠 */
export function segmentOverlaps(doc: TimelineDocument): [string, string][] {
  const segs = [...doc.segments].sort((a, b) => a.startSec - b.startSec)
  const out: [string, string][] = []
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[j].startSec < segs[i].endSec) {
        out.push([segs[i].id, segs[j].id])
      } else {
        break // 已排序：后续不再可能重叠
      }
    }
  }
  return out
}

/** 音频长度变化修正（1.0.0 T9）：超出时长的片段删除、越界 endSec 钳制回时长；changed=是否有改动 */
export function clampSegmentsToDuration(
  doc: TimelineDocument,
  durationSec: number
): { segments: TimelineSegment[]; changed: boolean } {
  if (durationSec <= 0) return { segments: doc.segments, changed: false }
  let changed = false
  const segments = doc.segments
    .filter((s) => {
      const keep = s.startSec < durationSec - 0.05
      if (!keep) changed = true
      return keep
    })
    .map((s) => {
      const end = Math.min(s.endSec, durationSec)
      if (end < s.startSec + 0.1) {
        changed = true
        return null
      }
      if (end !== s.endSec) changed = true
      return end === s.endSec ? s : { ...s, endSec: end }
    })
    .filter((s): s is TimelineSegment => s !== null)
  return { segments, changed }
}

/**
 * 解析 tSec 的完整布局：段布局（或全局基线）→ 关键帧轨道覆盖。
 * 不修改输入（返回新对象）；path 命中失败/值类型不符 → 跳过该轨道（容错）。
 */
export function resolveLayoutAt(layout: ProjectLayout, tSec: number): ProjectLayout {
  const doc = layout.timeline ?? { segments: [] }
  const seg = segmentAt(doc, tSec)
  if (!seg) return layout
  // 无关键帧：段视图即为最终布局（直接返回同一对象——预览逐帧调用零拷贝）
  if ((seg.keyframes ?? []).length === 0) return seg.layout ?? layout
  const base = structuredClone(seg.layout ?? layout)
  for (const track of seg.keyframes ?? []) {
    const v = trackValueAt(track, tSec - seg.startSec)
    if (v == null) continue
    const target = base as unknown as Record<string, unknown>
    const cur = getByPath(target, track.path)
    // 类型守卫：数值路径目标须为 number；颜色路径目标须为 string（键碰撞容错）
    if (
      (typeof v === 'number' && typeof cur !== 'number' && cur != null) ||
      (typeof v === 'string' && typeof cur !== 'string' && cur != null)
    ) {
      continue
    }
    setByPath(target, track.path, v)
  }
  return base
}
