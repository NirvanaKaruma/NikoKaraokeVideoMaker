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

export type EasingName = 'linear' | 'easeInOutQuad' | 'easeOutCubic' | 'bounce' | 'hold'

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
  /** 段内空关键帧槽（裸创建；t 相对段起点） */
  frameSlots?: number[]
  /**
   * 边界过渡（秒，0=硬切，默认）——**边界归属规则（单一归属，防双重混合）**：
   * - transitionInSec：段起始边界「上一锚点（前段结尾值 / 全局基线）→ 本段」软过渡时长；
   *   段与段相连时该边界**完全由后一段的 transitionInSec 决定**（前段不参与）；
   * - transitionOutSec：段尾后**无生效段**（空隙/歌曲结尾）时「本段 → 全局基线」软过渡时长；
   *   段尾为相接段落时不生效（该边界归属于下一段的进入过渡）。
   */
  transitionInSec?: number
  transitionOutSec?: number
}

export interface TimelineDocument {
  segments: TimelineSegment[]
  /**
   * 全局基线关键帧（1.1.0 用户 #3）：文档级轨道——**不分割时间轴也能打关键帧**；
   * 作用于整曲（t 为绝对时间），段级布局/轨道在其上覆盖（全局为底、段级为顶）。
   */
  keyframes?: PropertyTrack[]
  /** 空关键帧槽（裸创建的关键帧：无任何属性，可点开后逐属性添加；绝对秒） */
  frameSlots?: number[]
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
  bounce: bounceIn,
  /** 硬切：保持前值、到帧时刻突变（由 trackValueAt/applyTrackSet 分支处理，映射仅占位） */
  hold: (x) => x
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

/**
 * 轨道在 tSec 的值（用户确认语义）：**首帧之前 → 不应用（继承全局/段基准值——帧轨道的"左端点"开放）；
 * 首帧起 → 接管：帧间插值、末帧后 clamp（保持最近值，标准惯例）**。
 */
export function trackValueAt(track: PropertyTrack, tSec: number): KeyframeValue | null {
  if (track.frames.length === 0) return null
  const frames = [...track.frames].sort((x, y) => x.t - y.t)
  if (tSec < frames[0].t) return null
  const last = frames[frames.length - 1]
  if (tSec >= last.t) return last.value
  for (let i = 0; i < frames.length - 1; i++) {
    const f0 = frames[i]
    const f1 = frames[i + 1]
    if (tSec >= f0.t && tSec < f1.t) {
      // hold：保持前值、f1 时刻突变（硬切）；其余按前帧过渡方式插值
      if (f0.easing === 'hold') return f0.value
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

/** 相邻段边界钳制（用户反馈"段间重叠"根因：手柄拖拽可侵入相邻段——修复为不允许）：
 * 返回钳制后的 [startSec, endSec]；与相邻段保持 MIN_EDGE_GAP 间隙；不修改输入。 */
export const EDGE_GAP = 0.05
export function clampSegmentBoundsToNeighbors(
  segments: TimelineSegment[],
  id: string,
  startSec: number,
  endSec: number
): [number, number] {
  const sorted = [...segments].sort((a, b) => a.startSec - b.startSec)
  const idx = sorted.findIndex((s) => s.id === id)
  if (idx < 0) return [startSec, Math.max(startSec + 0.1, endSec)]
  // 首段左界钳回 0（时间轴起点）；末段右界不设上界（可拖出再钳回时长）
  const prevEnd = idx > 0 ? sorted[idx - 1].endSec : null
  const nextStart = idx < sorted.length - 1 ? sorted[idx + 1].startSec : null
  const a = prevEnd == null ? Math.max(0, startSec) : Math.max(startSec, prevEnd + EDGE_GAP)
  let b =
    nextStart == null
      ? Math.max(startSec + 0.1, endSec)
      : Math.min(Math.max(startSec + 0.1, endSec), nextStart - EDGE_GAP)
  if (b <= a + 0.1) b = a + 0.1
  return [a, b]
}

/** 分割（纯函数，供 useProject 调用）：含"无片段=整首切两段"（用户验收补丁）；
 * 数据上保证 [start,end) 无重叠（连续多次分割同样成立——单测覆盖）。 */
export function splitTimelineAt(
  doc: TimelineDocument,
  atSec: number,
  durationSec?: number
): { segments: TimelineSegment[]; changed: boolean } {
  const segs = doc.segments
  const idx = segs.findIndex((s) => atSec > s.startSec && atSec < s.endSec)
  if (idx < 0 && segs.length === 0) {
    if (durationSec == null || durationSec <= 0 || atSec <= 0 || atSec >= durationSec - 0.05) {
      return { segments: segs, changed: false }
    }
    return {
      changed: true,
      segments: [
        { id: crypto.randomUUID(), startSec: 0, endSec: atSec, layout: null, keyframes: [] },
        {
          id: crypto.randomUUID(),
          startSec: atSec,
          endSec: durationSec,
          layout: null,
          keyframes: []
        }
      ]
    }
  }
  if (idx < 0) return { segments: segs, changed: false }
  const seg = segs[idx]
  const id2 = crypto.randomUUID()
  const t0 = atSec - seg.startSec
  const kf1 = (seg.keyframes ?? [])
    .map((tr) => ({ ...tr, frames: tr.frames.filter((f) => f.t <= t0) }))
    .filter((tr) => tr.frames.length > 0)
  const kf2 = (seg.keyframes ?? [])
    .map((tr) => ({
      ...tr,
      frames: tr.frames.filter((f) => f.t > t0).map((f) => ({ ...f, t: f.t - t0 }))
    }))
    .filter((tr) => tr.frames.length > 0)
  // 空帧槽拆分：<=t0 留左侧段；>t0 平移给新段
  const slots1 = (seg.frameSlots ?? []).filter((x) => x <= t0)
  const slots2 = (seg.frameSlots ?? []).filter((x) => x > t0).map((x) => x - t0)
  // 边界过渡归属（边界单一归属制）：进入归属左半段、离开归属右半段；
  // 分割产生的新内边界（左→右）默认硬切（transitionInSec=undefined）。
  return {
    changed: true,
    segments: [
      ...segs.slice(0, idx),
      {
        ...seg,
        endSec: atSec,
        keyframes: kf1,
        frameSlots: slots1,
        transitionOutSec: undefined
      },
      {
        id: id2,
        startSec: atSec,
        endSec: seg.endSec,
        layout: seg.layout,
        keyframes: kf2,
        frameSlots: slots2,
        transitionInSec: undefined,
        transitionOutSec: seg.transitionOutSec
      },
      ...segs.slice(idx + 1)
    ]
  }
}

/** 轨道集应用（纯函数）：base 布局 + 轨道（t 为轨道内相对秒）→ 新布局；不修改输入 */
function applyTrackSet(
  base: ProjectLayout,
  tracks: PropertyTrack[],
  tSecRel: number
): ProjectLayout {
  const out = structuredClone(base)
  for (const track of tracks) {
    const first = [...track.frames].sort((x, y) => x.t - y.t)[0]
    // 「基准 → 首帧」过渡：t < 首帧 且非 hold → 基准与首帧值按首帧过渡方式渐变（段落到帧）
    if (first && tSecRel < first.t && first.easing !== 'hold') {
      const cur0 = getByPath(out, track.path)
      // 首帧在段起点（t≈0）：进入过渡窗口的"段提前生效"态直接取首帧值（边界到达=帧值）；
      // 否则按 [0, first.t] 渐变（基准 → 首帧：段落到帧）
      const span0 = Math.max(0.001, first.t)
      const p0 = first.t <= 0.001 ? 1 : Math.min(1, Math.max(0, tSecRel / span0))
      const eased0 = EASINGS[first.easing]?.(p0) ?? p0
      const v0 = interpolateValue(cur0 as number | string, first.value, eased0)
      if (cur0 != null && typeof cur0 === typeof first.value) {
        setByPath(out as unknown as Record<string, unknown>, track.path, v0)
      }
      continue
    }
    const v = trackValueAt(track, tSecRel)
    if (v == null) continue
    const target = out as unknown as Record<string, unknown>
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
  return out
}

/**
 * 解析 tSec 的完整布局：**全局基线轨道（整曲，绝对 t）→ 段布局/段轨道覆盖**（全局为底、段级为顶）。
 * 不修改输入（返回新对象）；path 命中失败/值类型不符 → 跳过该轨道（容错）。
 *
 * 1.0.0 关键帧编辑体验——锚点间过渡（段落到帧 / 段落到段落 / 段落到全局 / 全局到段落）：
 * - 段落到帧：applyTrackSet 内「基准→首帧」按首帧过渡方式渐变（hold = 硬切）；
 * - 边界过渡（边界单一归属）：transitionInSec=段首与上一锚点；transitionOutSec=段尾回全局（仅无生效段时）。
 * 解析优先级：进入窗口 → 离开窗口 → 常规段/全局；窗口递归嵌套（黑名单剥离已算段，防环）。
 */
export function resolveLayoutAt(layout: ProjectLayout, tSec: number): ProjectLayout {
  const doc = layout.timeline ?? { segments: [] }
  // 快路径：无边界过渡配置 → 原语义（零拷贝身份返回，WYSIWYG 引用稳定）
  if (!doc.segments.some((s) => (s.transitionInSec ?? 0) > 0 || (s.transitionOutSec ?? 0) > 0)) {
    return resolveCore(layout, doc, tSec)
  }
  return resolveTrans(layout, doc, tSec, new Set())
}

/** 常规解析（无边界过渡；black = 剥离段，供递归过渡的世界使用） */
function resolveCore(
  layout: ProjectLayout,
  doc: TimelineDocument,
  tSec: number,
  black?: Set<string>
): ProjectLayout {
  const globalTracks = doc.keyframes ?? []
  const seg = black ? segmentAtEx(doc, tSec, black) : segmentAt(doc, tSec)
  if (!seg) {
    return globalTracks.length > 0 ? applyTrackSet(layout, globalTracks, tSec) : layout
  }
  return resolveSegActive(layout, doc, seg, tSec)
}

/** 段」生效状态」解析（核心段分支复用）：全局轨道（绝对 t）→ 段快照/段轨道（相对起点） */
function resolveSegActive(
  layout: ProjectLayout,
  doc: TimelineDocument,
  seg: TimelineSegment,
  tSec: number
): ProjectLayout {
  const globalTracks = doc.keyframes ?? []
  // 段无关键帧：继承链 =（未物化 → 全局动画后的基线）或（已物化段快照=冻结）
  if ((seg.keyframes ?? []).length === 0) {
    if (!seg.layout) {
      return globalTracks.length > 0 ? applyTrackSet(layout, globalTracks, tSec) : layout
    }
    return seg.layout
  }
  const segBase = seg.layout ?? layout
  const withGlobal = globalTracks.length > 0 ? applyTrackSet(segBase, globalTracks, tSec) : segBase
  return applyTrackSet(withGlobal, seg.keyframes ?? [], tSec - seg.startSec)
}

/** 段查找（黑名单版）：忽略已剥离段（递归过渡的「无本段世界」）；防御性按 startSec 排序 */
function segmentAtEx(
  doc: TimelineDocument,
  tSec: number,
  black: Set<string>
): TimelineSegment | null {
  return (
    [...doc.segments]
      .sort((a, b) => a.startSec - b.startSec)
      .find((s) => !black.has(s.id) && tSec >= s.startSec && tSec < s.endSec) ?? null
  )
}

/** 边界过渡递归解析：black 每层剥离一个段（同段不重复、深度 ≤ 段数），嵌套混合（近边界优先） */
function resolveTrans(
  layout: ProjectLayout,
  doc: TimelineDocument,
  tSec: number,
  black: Set<string>
): ProjectLayout {
  // 1) 进入窗口 [start-d, start)：上一锚点世界（前段生效值/全局基线）→ 本段预期世界
  const inc = doc.segments
    .filter((s) => !black.has(s.id) && (s.transitionInSec ?? 0) > 0)
    .filter((s) => s.startSec > tSec && tSec >= s.startSec - (s.transitionInSec ?? 0))
    .filter(
      (s) =>
        // 交接守卫：前段覆盖本段起始 → 本段实际不生效（重叠，排序靠前者胜）→ 无进入过渡
        !doc.segments.some(
          (q) =>
            q.id !== s.id && !black.has(q.id) && q.startSec <= s.startSec && s.startSec < q.endSec
        )
    )
    .sort((a, b) => a.startSec - b.startSec)[0]
  if (inc) {
    const d = Math.max(0.001, inc.transitionInSec ?? 0)
    const p = Math.min(1, Math.max(0, (tSec - (inc.startSec - d)) / d))
    const next = new Set(black)
    next.add(inc.id)
    const from = resolveTrans(layout, doc, tSec, next)
    const to = resolveSegActive(layout, doc, inc, tSec)
    return lerpLayouts(from, to, p)
  }
  // 2) 离开窗口 [endSec, endSec+d)：无生效段（空隙/歌曲结尾）→ 段结尾值回全局基线
  const active = segmentAtEx(doc, tSec, black)
  if (!active) {
    const out = doc.segments
      .filter((s) => !black.has(s.id) && (s.transitionOutSec ?? 0) > 0)
      .filter((s) => s.endSec <= tSec && tSec < s.endSec + (s.transitionOutSec ?? 0))
      .sort((a, b) => b.endSec - a.endSec)[0]
    if (out) {
      const d = Math.max(0.001, out.transitionOutSec ?? 0)
      const p = Math.min(1, Math.max(0, (tSec - out.endSec) / d))
      const from = resolveSegActive(layout, doc, out, tSec)
      const globalTracks = doc.keyframes ?? []
      const to = globalTracks.length > 0 ? applyTrackSet(layout, globalTracks, tSec) : layout
      return lerpLayouts(from, to, p)
    }
  }
  // 3) 常规
  return resolveCore(layout, doc, tSec, black)
}

/**
 * 布局间插值混合（纯函数）：叶子数值 lerp / 颜色按通道插值 / 其他字符串中点切换；
 * 数组按索引（长度一致时）、对象按键并集（以 b=目标态为骨架）；p<=0 → a，p>=1 → b。
 */
export function lerpLayouts(a: ProjectLayout, b: ProjectLayout, p: number): ProjectLayout {
  if (p <= 0) return a
  if (p >= 1) return b
  return blendValue(a, b, p) as ProjectLayout
}

function blendValue(a: unknown, b: unknown, p: number): unknown {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p
  if (typeof a === 'string' && typeof b === 'string') return interpolateValue(a, b, p)
  if (a != null && b != null && typeof a === 'object' && typeof b === 'object') {
    if (Array.isArray(a) !== Array.isArray(b)) return b
    if (Array.isArray(a)) {
      const at = a as unknown[]
      const bt = b as unknown[]
      if (at.length !== bt.length) return b
      return bt.map((bv, i) => blendValue(at[i], bv, p))
    }
    const ao = a as Record<string, unknown>
    const bo = b as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(bo)) {
      out[k] = k in ao ? blendValue(ao[k], bo[k], p) : bo[k]
    }
    return out
  }
  // 类型不匹配/特殊值 → 目标态
  return b
}
