import { useRef } from 'react'
import type { PropertyTrack, TimelineSegment } from '@shared/timeline'
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
  /** 段边界过渡（1.0.0 关键帧编辑体验：段落到段落/全局；kind='in'=进入 | 'out'=离开；0 = 硬切，0–3s） */
  onUpdateTransition?: (id: string, kind: 'in' | 'out', sec: number) => void
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

  /** 段的后继段（start >= endSec-ε 的最近一个） */
  const nextSegOf = (s: TimelineSegment): TimelineSegment | null =>
    props.segments
      .filter((q) => q.id !== s.id && q.startSec >= s.endSec - 0.001)
      .sort((a, b) => a.startSec - b.startSec)[0] ?? null
  /** 段尾与下一段相接（无空隙）→ 该边界由下一段的「进入过渡」接管（本段离开过渡不生效） */
  const boundaryContiguous = (s: TimelineSegment): boolean => {
    const next = nextSegOf(s)
    return next != null && next.startSec <= s.endSec + 0.001
  }

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
        {selected && (
          <label className="timeline-transition" title={t('timeline.transitionInHint')}>
            {t('timeline.transitionIn')}
            <input
              type="number"
              min={0}
              max={3}
              step={0.1}
              value={Math.round((selected.transitionInSec ?? 0) * 10) / 10}
              onChange={(e) =>
                props.onUpdateTransition?.(selected.id, 'in', Number(e.target.value))
              }
            />
            s
          </label>
        )}
        {selected &&
          (boundaryContiguous(selected) ? (
            <span className="timeline-transition-na" title={t('timeline.transitionOutHint')}>
              {t('timeline.transitionOut')}：{t('timeline.transitionOutNa')}
            </span>
          ) : (
            <label className="timeline-transition" title={t('timeline.transitionOutHint')}>
              {t('timeline.transitionOut')}
              <input
                type="number"
                min={0}
                max={3}
                step={0.1}
                value={Math.round((selected.transitionOutSec ?? 0) * 10) / 10}
                onChange={(e) =>
                  props.onUpdateTransition?.(selected.id, 'out', Number(e.target.value))
                }
              />
              s
            </label>
          ))}
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
        {/* 边界过渡窗口可视化：段前方 = 进入（与上一锚点）；段尾后无下一段 = 离开回全局 */}
        {props.segments.map((s) => {
          const din = s.transitionInSec ?? 0
          const dout = s.transitionOutSec ?? 0
          if (din <= 0 && dout <= 0) return null
          const next = nextSegOf(s)
          const contiguous = next != null && next.startSec <= s.endSec + 0.001
          const a0 = Math.max(0, s.startSec - din)
          return (
            <div key={'tw' + s.id} className="timeline-trans-windows">
              {din > 0 && s.startSec > a0 && (
                <span
                  className="timeline-trans-window"
                  style={{
                    left: ratio(a0) * 100 + '%',
                    width: (ratio(s.startSec) - ratio(a0)) * 100 + '%'
                  }}
                />
              )}
              {dout > 0 && !contiguous && (
                <span
                  className="timeline-trans-window"
                  style={{
                    left: ratio(s.endSec) * 100 + '%',
                    width: (ratio(s.endSec + dout) - ratio(s.endSec)) * 100 + '%'
                  }}
                />
              )}
            </div>
          )
        })}
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
