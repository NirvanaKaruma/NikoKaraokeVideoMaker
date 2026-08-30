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
import { beatPeriod, bounceIn, easeInOutQuad, easeOutCubic } from './fx'

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
   * 段属性过渡（v4，用户确认：**过渡属于段落本身**——改长度/增删相邻段都不会失效）：
   * - transitionIn：段首过渡——本段开头 durationSec 秒**从全局基线淡入**（曲线 easing；0/hold = 硬切）；
   * - transitionOut：段尾过渡——本段结尾 durationSec 秒**向全局基线淡出**。
   * 两个窗口各在段头/段尾、各 ≤ 段长一半 → 天然不重叠、无归属歧义；相接处 = 段尾淡出 + 下一段首淡入（都过全局基线，连续）。
   */
  transitionIn?: CutTransitionSpec
  transitionOut?: CutTransitionSpec
}

/** 过渡规格（时长 + 曲线；durationSec 0 = 硬切；easing hold = 硬切退化） */
export interface CutTransitionSpec {
  /** 时长（秒，0 = 硬切） */
  durationSec: number
  /** 过渡曲线（默认 linear） */
  easing: EasingName
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

/** 相邻段边界钳制（用户反馈"段间重叠"根因：手柄拖拽可侵入相邻段）：
 * 返回钳制后的 [startSec, endSec]——允许与相邻段**精确相接**（半开区间不重叠），
 * 配合磁性吸附保持切点过渡存在（微小拖动不再丢失配对）。
 * 相接判定容差（切点/UI 共用）。 */
export const CUT_ADJ_EPS = 0.05
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
  const a = prevEnd == null ? Math.max(0, startSec) : Math.max(startSec, prevEnd)
  let b =
    nextStart == null
      ? Math.max(startSec + 0.1, endSec)
      : Math.min(Math.max(startSec + 0.1, endSec), nextStart)
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
  // 切点过渡（NLE 式，doc.transitions）由 useProject 侧按分段结果重映射；
  // 分割产生的新内边界默认硬切（无切点配置）。
  return {
    changed: true,
    segments: [
      ...segs.slice(0, idx),
      { ...seg, endSec: atSec, keyframes: kf1, frameSlots: slots1 },
      {
        id: id2,
        startSec: atSec,
        endSec: seg.endSec,
        layout: seg.layout,
        keyframes: kf2,
        frameSlots: slots2
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
 * 锚点间过渡（v5 段属性 + 目标跟随模型，用户确认：**过渡属于段落本身**——改长度/增删相邻段都不失效；
 * 相接的两段应**直接互溶**，不经过背景层）：
 * - 段落到帧：applyTrackSet 内「基准→首帧」按首帧过渡方式渐变（hold = 硬切）；
 * - 段属性过渡：transitionIn（段首 d 秒与**上一锚点**（相接前段或全局基线）互溶）/ transitionOut（段尾 d 秒
 *   与**下一锚点**（相接后段或全局基线）互溶）——设置属于段落、目标跟随场景；
 * - 相接处两段都设过渡 → 合并为**一条连续互溶窗**（A↔B 直接互溶，时长 = 两侧之和；曲线取段尾侧）；
 * - 每侧窗口 ≤ 段长一半 → 任意两窗口不相交（无嵌套混合/打架）。无过渡配置 → 原零拷贝语义。
 */

/** 过渡窗口（引擎与时间轴可视化共用的计算产物）：[w0, w1) 内 from↔to 按曲线互溶；'g' = 全局基线 */
export interface TransitionWindow {
  fromId: string
  toId: string
  w0: number
  w1: number
  easing: EasingName
}

/** 全局基线锚点标识 */
export const GLOBAL_ANCHOR = 'g'

/**
 * 计算全部生效过渡窗口（纯函数 = 所见即所得）：
 * 段首（前面无相接段）→ [start, start+inH)；段尾 → 与后接锚点（相接段或全局）互溶；
 * 后段也设段首过渡时二者合并（[end-outH, nextStart+inH)，曲线取段尾侧）；每侧 ≤ 段长一半。
 */
export function computeTransitionWindows(doc: TimelineDocument): TransitionWindow[] {
  const segs = [...doc.segments].sort((a, b) => a.startSec - b.startSec)
  const hOf = (spec: CutTransitionSpec | undefined, dur: number): number =>
    spec && spec.durationSec > 0 && spec.easing !== 'hold' ? Math.min(spec.durationSec, dur / 2) : 0
  const out: TransitionWindow[] = []
  for (const s of segs) {
    const dur = Math.max(0.1, s.endSec - s.startSec)
    const inH = hOf(s.transitionIn, dur)
    const outH = hOf(s.transitionOut, dur)
    const prev = segs
      .filter((q) => q.id !== s.id && q.endSec <= s.startSec + CUT_ADJ_EPS)
      .sort((a, b) => b.endSec - a.endSec)[0]
    const prevAdj = prev && Math.abs(prev.endSec - s.startSec) <= CUT_ADJ_EPS ? prev : null
    const next = segs
      .filter((q) => q.id !== s.id && q.startSec >= s.endSec - CUT_ADJ_EPS)
      .sort((a, b) => a.startSec - b.startSec)[0]
    const nextAdj = next && Math.abs(next.startSec - s.endSec) <= CUT_ADJ_EPS ? next : null
    // 段首：前面无相接段 → 从全局基线互溶（相接时由前段的段尾窗口统一覆盖）
    if (!prevAdj && inH > 0) {
      out.push({
        fromId: GLOBAL_ANCHOR,
        toId: s.id,
        w0: s.startSec,
        w1: s.startSec + inH,
        easing: s.transitionIn?.easing ?? 'linear'
      })
    }
    // 段尾：与后接锚点互溶（GLOBAL 或相接段）；后段段首过渡并入同一窗口（A↔B 直接互溶）
    const nInH = nextAdj
      ? hOf(nextAdj.transitionIn, Math.max(0.1, nextAdj.endSec - nextAdj.startSec))
      : 0
    if (outH > 0 || nInH > 0) {
      out.push({
        fromId: s.id,
        toId: nextAdj ? nextAdj.id : GLOBAL_ANCHOR,
        w0: s.endSec - outH,
        w1: (nextAdj ? nextAdj.startSec : s.endSec) + nInH,
        easing: s.transitionOut?.easing ?? nextAdj?.transitionIn?.easing ?? 'linear'
      })
    }
  }
  return out
}

/** 全局基线解析（基准层：全局轨道绝对 t 应用） */
function globalResolve(layout: ProjectLayout, doc: TimelineDocument, tSec: number): ProjectLayout {
  const globalTracks = doc.keyframes ?? []
  return globalTracks.length > 0 ? applyTrackSet(layout, globalTracks, tSec) : layout
}

/** 解析 tSec 的完整布局（公开入口）：快路径（无段属性过渡）→ 原零拷贝语义 */
export function resolveLayoutAt(layout: ProjectLayout, tSec: number): ProjectLayout {
  const doc = layout.timeline ?? { segments: [] }
  if (!doc.segments.some((s) => s.transitionIn || s.transitionOut)) {
    return resolveCore(layout, doc, tSec)
  }
  return resolveTransitioned(layout, doc, tSec)
}

/** 常规解析（无过渡窗口命中）：生效段或全局 */
function resolveCore(layout: ProjectLayout, doc: TimelineDocument, tSec: number): ProjectLayout {
  const seg = segmentAt(doc, tSec)
  if (!seg) return globalResolve(layout, doc, tSec)
  return resolveSegActive(layout, doc, seg, tSec)
}

/** 段「生效态」解析（核心段分支复用）：全局轨道（绝对 t）→ 段快照/段轨道（相对起点） */
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

/** 段属性过渡解析：命中过渡窗口 → 双锚点世界按曲线互溶（段侧可拉伸/提前，全局侧=基线）；未命中 → 常规 */
function resolveTransitioned(
  layout: ProjectLayout,
  doc: TimelineDocument,
  tSec: number
): ProjectLayout {
  for (const w of computeTransitionWindows(doc)) {
    if (tSec < w.w0 || tSec >= w.w1) continue
    const p = Math.min(1, Math.max(0, (tSec - w.w0) / Math.max(0.001, w.w1 - w.w0)))
    const eased = EASINGS[w.easing]?.(p) ?? p
    return lerpLayouts(
      resolveAnchorWorld(layout, doc, w.fromId, tSec),
      resolveAnchorWorld(layout, doc, w.toId, tSec),
      eased
    )
  }
  return resolveCore(layout, doc, tSec)
}

/** 锚点世界解析：'g' = 全局基线；段 id = 段生效态（拉伸/提前由 resolveSegActive 处理） */
function resolveAnchorWorld(
  layout: ProjectLayout,
  doc: TimelineDocument,
  id: string,
  tSec: number
): ProjectLayout {
  if (id === GLOBAL_ANCHOR) return globalResolve(layout, doc, tSec)
  const seg = doc.segments.find((s) => s.id === id)
  return seg ? resolveSegActive(layout, doc, seg, tSec) : globalResolve(layout, doc, tSec)
}

/**
 * 变 BPM 节拍蓄积（纯函数、确定性、O(区间数)）：拍数 = ∫du/periodAt(u)——跨段变速/换节拍源时**拍相位连续**（不跳拍），
 * 匹配「很多歌是变 BPM」场景。「分段常量」近似：按段落边界切分区间（段外 = 全局区），每区间周期取其中心时刻的解析值；
 * 无效周期区间不推进（节拍关闭）。快路径：完全无关键帧且段无物化 → 单次解析（周期恒定）。
 */
export function beatTimeAt(layout: ProjectLayout, tSec: number): number {
  if (tSec <= 0) return 0
  const doc = layout.timeline ?? { segments: [] }
  const flat =
    (doc.keyframes ?? []).length === 0 &&
    doc.segments.every((s) => s.layout == null && (s.keyframes ?? []).length === 0)
  if (flat) {
    const p = beatPeriod(layout.visualizer.bpm, layout.visualizer.beatIntervalSec)
    return p != null && p > 0 ? tSec / p : 0
  }
  const marks = [0, ...doc.segments.flatMap((s) => [s.startSec, s.endSec]), tSec]
    .filter((m) => m >= 0)
    .sort((a, b) => a - b)
  const pts = [...new Set(marks.map((m) => Math.max(0, m)))]
  let beats = 0
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]
    const b = Math.min(pts[i + 1], tSec)
    if (b <= a) continue
    const resolved = resolveLayoutAt(layout, (a + b) / 2)
    const p = beatPeriod(resolved.visualizer.bpm, resolved.visualizer.beatIntervalSec)
    if (p != null && p > 0 && Number.isFinite(p)) beats += (b - a) / p
  }
  return beats
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
