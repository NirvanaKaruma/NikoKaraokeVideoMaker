import { useRef } from 'react'
import {
  computeCutWindows,
  GLOBAL_ANCHOR,
  pairCutKey,
  type PropertyTrack,
  type TimelineSegment
} from '@shared/timeline'
import { useLocale } from '../hooks/useLocale'

export interface TimelineBarProps {
  segments: TimelineSegment[]
  /** 总时长（秒，音频时长；画布映射基准） */
  durationSec: number
  /** 播放头（秒） */
  currentT: number
  selectedSegmentId: string | null
  onSeek: (t: number) => void
  onSelectSegment: (id: string | null) => void
  onSplitAt: (t: number) => void
  onRemoveSegment: (id: string) => void
  onUpdateBounds: (id: string, startSec: number, endSec: number) => void
  /** 切点过渡（NLE 式：过渡属于编辑点/切点；cutKey = 左锚点|右锚点，'g' = 全局基线；0 = 硬切，0–3s） */
  onUpdateCut?: (cutKey: string, sec: number) => void
  /** 切点过渡配置（doc.transitions 映射：锚点对 -> 秒） */
  transitions?: Record<string, number>
  /** 重叠片段 id（T9 非破坏校验：标红 + 提示——重叠区间按排序靠前者生效） */
  overlaps?: string[]
  /** 点时间轴关键帧/槽：跳播 + 选中帧（段内传 segId；全局传 null）——与普通 seek（清帧）分离 */
  onKfSeek?: (tAbs: number, segId: string | null) => void
  /** 全局基线关键帧轨道（整曲绝对 t）：在轨道上绘制标注（1.1.0 用户反馈） */
  globalKeyframes?: PropertyTrack[]
  /** 全局空帧槽（裸创建；绝对 t） */
  globalSlots?: number[]
  /** 关闭时间轴（可选；App 顶部可重开） */
  onClose?: () => void
}

const PX_PER_SEC_BASE = 40

/**
 * 底部时间轴（1.0.0 T3）：独立组件、props 纯配置（单职责/可复用）。
 * 片段块/播放头/刻度条；点击或拖动播放头 seek；选中片段 → 手柄改边界 + 删除；✂ 在播放头处分割。
 */
export function TimelineBar(props: TimelineBarProps): React.JSX.Element {
  const { t } = useLocale()
  const trackRef = useRef<HTMLDivElement>(null)
  const dur = Math.max(0.1, props.durationSec)
  /** 0–1 时间映射 */
  const ratio = (sec: number): number => Math.min(1, Math.max(0, sec / dur))

  const seekFromEvent = (clientX: number): void => {
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const r0 = Math.min(1, Math.max(0, (clientX - r.left) / Math.max(1, r.width)))
    props.onSeek(r0 * dur)
  }

  const selected = props.segments.find((s) => s.id === props.selectedSegmentId) ?? null

  /** 相邻段（按端点相接；±0.001 容差） */
  const prevAdj = (s: TimelineSegment): TimelineSegment | null => {
    const p = props.segments
      .filter((q) => q.id !== s.id && q.endSec <= s.startSec + 0.001)
      .sort((a, b) => b.endSec - a.endSec)[0]
    return p && Math.abs(p.endSec - s.startSec) <= 0.001 ? p : null
  }
  const nextAdj = (s: TimelineSegment): TimelineSegment | null => {
    const n = props.segments
      .filter((q) => q.id !== s.id && q.startSec >= s.endSec - 0.001)
      .sort((a, b) => a.startSec - b.startSec)[0]
    return n && Math.abs(n.startSec - s.endSec) <= 0.001 ? n : null
  }
  /** 按分段顺序的后继（含空隙；用于「断开保留」提示） */
  const nextByOrder = (s: TimelineSegment): TimelineSegment | null =>
    props.segments
      .filter((q) => q.id !== s.id && q.startSec >= s.endSec - 0.001)
      .sort((a, b) => a.startSec - b.startSec)[0] ?? null
  const segIndex = (s: TimelineSegment): number => props.segments.indexOf(s) + 1

  const resize = (e: React.PointerEvent, id: string, edge: 'l' | 'r'): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = trackRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const seg = props.segments.find((s) => s.id === id)
    if (!seg) return
    const move = (ev: PointerEvent): void => {
      const t = ((ev.clientX - r.left) / Math.max(1, r.width)) * dur
      let [a, b] = [seg.startSec, seg.endSec]
      if (edge === 'l') a = Math.min(t, b - 0.1)
      else b = Math.max(t, a + 0.1)
      props.onUpdateBounds(id, a, b)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <div className="timeline-bar">
      <div className="timeline-toolbar">
        <span className="timeline-title">{t('timeline.title')}</span>
        <button
          type="button"
          className="btn-sm"
          onClick={() => props.onSplitAt(props.currentT)}
          disabled={dur <= 0}
        >
          {t('timeline.split')}
        </button>
        {selected && (
          <button
            type="button"
            className="btn-sm danger"
            onClick={() => props.onRemoveSegment(selected.id)}
          >
            {t('timeline.remove')}
          </button>
        )}
        {selected &&
          (() => {
            const tns = props.transitions ?? {}
            const pSeg = prevAdj(selected)
            const nSeg = nextAdj(selected)
            const headKey = pSeg
              ? pairCutKey(pSeg.id, selected.id)
              : GLOBAL_ANCHOR + '|' + selected.id
            const tailKey = nSeg
              ? pairCutKey(selected.id, nSeg.id)
              : selected.id + '|' + GLOBAL_ANCHOR
            const headD = tns[headKey] ?? 0
            const tailD = tns[tailKey] ?? 0
            // 断开保留提示：按序后段存在且有 (本段|后段) 非零配置——空隙状态下不生效、重接后生效
            const nOrder = nextByOrder(selected)
            const kept = nOrder && !nSeg ? (tns[pairCutKey(selected.id, nOrder.id)] ?? 0) : 0
            return (
              <>
                <label
                  className="timeline-transition"
                  title={
                    pSeg
                      ? t('timeline.cutPairHint', { i: segIndex(pSeg) })
                      : t('timeline.cutHeadHint')
                  }
                >
                  {pSeg ? t('timeline.cutPair', { i: segIndex(pSeg) }) : t('timeline.cutHead')}
                  <input
                    type="number"
                    min={0}
                    max={3}
                    step={0.1}
                    value={Math.round(headD * 10) / 10}
                    onChange={(e) => props.onUpdateCut?.(headKey, Number(e.target.value))}
                  />
                  s
                </label>
                <label
                  className="timeline-transition"
                  title={
                    nSeg
                      ? t('timeline.cutPairHint', { i: segIndex(nSeg) })
                      : t('timeline.cutTailHint')
                  }
                >
                  {nSeg ? t('timeline.cutPair', { i: segIndex(nSeg) }) : t('timeline.cutTail')}
                  <input
                    type="number"
                    min={0}
                    max={3}
                    step={0.1}
                    value={Math.round(tailD * 10) / 10}
                    onChange={(e) => props.onUpdateCut?.(tailKey, Number(e.target.value))}
                  />
                  s
                </label>
                {kept > 0 && (
                  <span className="timeline-transition-na">
                    {t('timeline.cutPairInactive', {
                      i: segIndex(nOrder as TimelineSegment),
                      d: String(kept)
                    })}
                  </span>
                )}
              </>
            )
          })()}
        <span className="panel-note">{t('timeline.hint')}</span>
        {(props.overlaps?.length ?? 0) > 0 && (
          <span className="timeline-overlap-note">{t('timeline.overlap')}</span>
        )}
        {props.onClose && (
          <button type="button" className="btn-sm timeline-close" onClick={props.onClose}>
            ✕
          </button>
        )}
      </div>
      <div
        ref={trackRef}
        className="timeline-track"
        style={{ backgroundSize: PX_PER_SEC_BASE * 1 + 'px 100%' }}
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest('.segment-block')) return
          seekFromEvent(e.clientX)
        }}
        onPointerMove={(e) => {
          if (e.buttons !== 1) return
          if ((e.target as HTMLElement).closest('.segment-block')) return
          seekFromEvent(e.clientX)
        }}
      >
        {/* 刻度（每秒一条；1/5/10s 粗细分级） */}
        {Array.from({ length: Math.floor(dur) + 1 }).map((_, i) => (
          <div
            key={i}
            className={'timeline-tick' + (i % 10 === 0 ? ' major' : i % 5 === 0 ? ' mid' : '')}
            style={{ left: ratio(i) * 100 + '%' }}
            title={i + 's'}
          />
        ))}
        {/* 切点过渡窗口可视化（与引擎 computeCutWindows 同一来源 = 所见即所得）：居中、侧向钳制 */}
        {computeCutWindows({ segments: props.segments }, props.transitions ?? {}).map((w) => (
          <div key={'tw' + w.key} className="timeline-trans-windows">
            <span
              className="timeline-trans-window"
              style={{
                left: ratio(w.pos - w.hL) * 100 + '%',
                width: (ratio(w.pos + w.hR) - ratio(w.pos - w.hL)) * 100 + '%'
              }}
            />
          </div>
        ))}
        {/* 片段块 */}
        {props.segments.map((s) => (
          <div
            key={s.id}
            className={
              'segment-block' +
              (props.selectedSegmentId === s.id ? ' selected' : '') +
              (s.layout ? ' detached' : '') +
              (props.overlaps?.includes(s.id) ? ' overlap' : '')
            }
            style={{
              // 段间 2px 视觉缝隙；极窄段最小显示宽 0.2%（≈2-3px 竖条）——
              // 修复：旧 Math.max(0.2,…)=20% 会把靠前分割出的窄段撑到 20% 与相邻块视觉交叠
              left: 'calc(' + ratio(s.startSec) * 100 + '% + 1px)',
              width:
                'calc(' + Math.max(0.002, ratio(s.endSec) - ratio(s.startSec)) * 100 + '% - 2px)'
            }}
            onPointerDown={(e) => {
              e.stopPropagation()
              props.onSelectSegment(s.id)
            }}
            title={s.layout ? '' : t('timeline.inherit')}
          >
            <span className="segment-label">
              {t('timeline.segmentLabel', { i: props.segments.indexOf(s) + 1 })}
              {s.layout ? '' : ' · ' + t('timeline.inherit')}
            </span>
            {/* 关键帧点标注（t 相对片段起点；用户反馈"时间轴不可观察"→ 直接可视化） */}
            {(s.keyframes ?? [])
              .flatMap((tr) => tr.frames)
              .map((f, fi) => (
                <span
                  key={fi}
                  className="segment-kf"
                  style={{
                    left: (f.t / Math.max(0.1, s.endSec - s.startSec)) * 100 + '%'
                  }}
                  title={'t=' + (s.startSec + f.t).toFixed(2) + 's ' + String(f.value)}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    props.onKfSeek?.(s.startSec + f.t, s.id)
                  }}
                />
              ))}
            {/* 段内空槽点（裸创建的关键帧） */}
            {(s.frameSlots ?? []).map((st, si) => (
              <span
                key={'s' + si}
                className="segment-kf slot"
                style={{ left: (st / Math.max(0.1, s.endSec - s.startSec)) * 100 + '%' }}
                title={t('kf.emptyFrame')}
                onClick={(ev) => {
                  ev.stopPropagation()
                  props.onKfSeek?.(s.startSec + st, s.id)
                }}
              />
            ))}
            <span className="segment-handle l" onPointerDown={(e) => resize(e, s.id, 'l')} />
            <span className="segment-handle r" onPointerDown={(e) => resize(e, s.id, 'r')} />
          </div>
        ))}
        {/* 全局空槽标注 */}
        {(props.globalSlots ?? []).map((st, si) => (
          <span
            key={'gs' + si}
            className="timeline-global-kf slot"
            style={{ left: ratio(st) * 100 + '%' }}
            title={t('kf.emptyFrame')}
            onClick={() => props.onKfSeek?.(st, null)}
          />
        ))}
        {/* 全局基线关键帧标注（整曲绝对 t；未分割也可观察） */}
        {(props.globalKeyframes ?? [])
          .flatMap((tr) => tr.frames)
          .map((f, fi) => (
            <span
              key={fi}
              className="timeline-global-kf"
              style={{ left: ratio(f.t) * 100 + '%' }}
              title={'t=' + f.t.toFixed(2) + 's ' + String(f.value)}
              onClick={() => props.onKfSeek?.(f.t, null)}
            />
          ))}
        {/* 播放头 */}
        <div className="timeline-playhead" style={{ left: ratio(props.currentT) * 100 + '%' }}>
          <div className="timeline-playhead-head" />
        </div>
      </div>
    </div>
  )
}
