import { useRef, useState } from 'react'
import type { ProjectLayout } from '@shared/layout'
import {
  KEYFRAME_CATALOG,
  catalogEntry,
  currentValueAt,
  type KeyframeCatalogEntry
} from '@shared/keyframeCatalog'
import type { EasingName, Keyframe, PropertyTrack } from '@shared/timeline'
import { useLocale } from '../../hooks/useLocale'

export interface KeyframePanelProps {
  /** 当前编辑片段（null=未选段：显示提示） */
  segId: string | null
  segStartSec: number
  segEndSec: number
  /** 该段关键帧轨道 */
  tracks: PropertyTrack[]
  /** 当前播放头（绝对秒；「添加关键帧」落在播放头） */
  currentT: number
  /** 当前编辑视图（捕获「添加关键帧」的当前属性值——T4 面板联动） */
  view: ProjectLayout
  onTracksChange: (tracks: PropertyTrack[]) => void
}

const EASING_OPTIONS: EasingName[] = ['linear', 'easeInOutQuad', 'easeOutCubic', 'bounce']

/** 数字显示：×displayScale（默认原值） */
function displayOf(v: number, c: KeyframeCatalogEntry): number {
  return (v * (c.displayScale ?? 1)) | 0
}
function rawOf(v: number, c: KeyframeCatalogEntry): number {
  return v / (c.displayScale ?? 1)
}

/**
 * 片段内关键帧编辑器（1.0.0 T5，纯 props）：
 * 轨道清单（v1 可动画属性）→ 关键帧点拖拽（相对片段时间）/删除/缓动下拉、
 * 「在此添加关键帧」捕获当前面板值（view）；与 T4 面板联动：捕获 + 段视图读写同源。
 */
export function KeyframePanel(props: KeyframePanelProps): React.JSX.Element {
  const { t } = useLocale()
  const [selPath, setSelPath] = useState<string | null>(null)
  const [selPoint, setSelPoint] = useState<number>(0)
  const stripRef = useRef<HTMLDivElement>(null)

  const segLen = Math.max(0.1, props.segEndSec - props.segStartSec)
  const entry = selPath ? catalogEntry(selPath) : null
  const track = selPath ? (props.tracks.find((x) => x.path === selPath) ?? null) : null
  const frames = track?.frames ?? []

  /** 相对播放头（裁剪到片段内） */
  const relT = Math.min(segLen, Math.max(0, props.currentT - props.segStartSec))

  const setFrames = (next: Keyframe[]): void => {
    if (!selPath || !track) return
    const sorted = [...next].sort((a, b) => a.t - b.t)
    props.onTracksChange(
      props.tracks.map((x) => (x.path === selPath ? { ...x, frames: sorted } : x))
    )
  }

  const addFrame = (): void => {
    if (!entry) return
    const v = currentValueAt(props.view, entry.path)
    if (v == null) return
    const nf: Keyframe = { t: +relT.toFixed(3), value: v, easing: 'linear' }
    const next = [...frames.filter((f) => Math.abs(f.t - nf.t) > 0.01), nf].sort(
      (a, b) => a.t - b.t
    )
    setFrames(next)
    setSelPoint(next.findIndex((f) => f === nf))
  }

  const movePoint = (e: React.PointerEvent, i: number): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = stripRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const move = (ev: PointerEvent): void => {
      const t = ((ev.clientX - rect.left) / Math.max(1, rect.width)) * segLen
      const next = frames.map((f, j) =>
        j === i ? { ...f, t: +Math.min(segLen, Math.max(0, t)).toFixed(3) } : f
      )
      setFrames(next)
    }
    const up = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const setPointValue = (v: number | string): void => {
    const cur = frames[selPoint]
    if (!cur) return
    setFrames(frames.map((f, j) => (j === selPoint ? { ...f, value: v } : f)))
  }

  const sel = frames[selPoint]

  return (
    <div className="kf-panel">
      {!props.segId ? (
        <div className="panel-note">{t('kf.hintNoSegment')}</div>
      ) : (
        <>
          <div className="panel-note">{t('kf.hint')}</div>
          {/* 轨道清单 */}
          <div className="kf-track-list">
            {KEYFRAME_CATALOG.map((c) => {
              const has = props.tracks.some((x) => x.path === c.path && x.frames.length > 0)
              return (
                <button
                  key={c.path}
                  type="button"
                  className={'kf-track' + (selPath === c.path ? ' active' : '')}
                  onClick={() => {
                    setSelPath(c.path)
                    setSelPoint(Math.max(0, framesOf(props.tracks, c.path).length - 1))
                  }}
                >
                  <span>{t(c.labelKey)}</span>
                  {has && <span className="kf-dot">◆</span>}
                </button>
              )
            })}
          </div>
          {entry && (
            <>
              {/* 添加关键帧条：显示播放头 + 当前值（T4 面板联动） */}
              <div className="kf-addbar">
                <span className="kf-time">t={relT.toFixed(2)}s</span>
                <span className="kf-cur">
                  {t('kf.currentValue')}: {String(currentValueAt(props.view, entry.path) ?? '—')}
                </span>
                <button type="button" className="btn-sm" onClick={addFrame}>
                  {t('kf.addAt')}
                </button>
              </div>
              {/* 关键帧点条 */}
              {frames.length > 0 ? (
                <div
                  ref={stripRef}
                  className="kf-strip"
                  onPointerDown={(e) => {
                    const el = stripRef.current
                    if (!el) return
                    const rect = el.getBoundingClientRect()
                    const t = ((e.clientX - rect.left) / Math.max(1, rect.width)) * segLen
                    addFrameAt(t)
                  }}
                >
                  {frames.map((f, i) => (
                    <div
                      key={i}
                      className={
                        'kf-point' + (selPoint === i && selPath === track?.path ? ' active' : '')
                      }
                      style={{ left: (f.t / segLen) * 100 + '%' }}
                      onPointerDown={(e) => {
                        e.stopPropagation()
                        setSelPoint(i)
                        movePoint(e, i)
                      }}
                      title={JSON.stringify(f.value)}
                    />
                  ))}
                </div>
              ) : (
                <div className="kf-strip empty">{t('kf.noPoint')}</div>
              )}
              {/* 选中点编辑：值 + 缓动 + 删除 */}
              {sel && (
                <div className="kf-editor">
                  <span className="kf-editor-label">{t('kf.value')}</span>
                  {entry.kind === 'number' ? (
                    <input
                      className="kf-num"
                      type="number"
                      step={entry.step * (entry.displayScale ?? 1)}
                      value={displayOf(sel.value as number, entry)}
                      onChange={(e) => {
                        const n = Number(e.target.value)
                        if (Number.isFinite(n)) setPointValue(rawOf(n, entry))
                      }}
                    />
                  ) : (
                    <span className="kf-color">
                      <input
                        type="color"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(String(sel.value))
                            ? String(sel.value)
                            : '#000000'
                        }
                        onChange={(e) => setPointValue(e.target.value)}
                      />
                      <input
                        className="kf-num"
                        type="text"
                        value={String(sel.value)}
                        onChange={(e) => setPointValue(e.target.value)}
                      />
                    </span>
                  )}
                  <span className="kf-editor-label">{t('kf.easing')}</span>
                  <select
                    className="kf-select"
                    value={sel.easing}
                    onChange={(e) =>
                      setFrames(
                        frames.map((f, j) =>
                          j === selPoint ? { ...f, easing: e.target.value as EasingName } : f
                        )
                      )
                    }
                  >
                    {EASING_OPTIONS.map((k) => (
                      <option key={k} value={k}>
                        {t('kf.easing' + capitalize(k))}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="btn-sm danger"
                    onClick={() => {
                      const next = frames.filter((_, j) => j !== selPoint)
                      setFrames(next)
                      setSelPoint(Math.max(0, selPoint - 1))
                    }}
                  >
                    {t('kf.remove')}
                  </button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )

  function capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1)
  }

  function framesOf(trs: PropertyTrack[], path: string): Keyframe[] {
    return trs.find((x) => x.path === path)?.frames ?? []
  }

  function addFrameAt(t: number): void {
    if (!entry) return
    const v = currentValueAt(props.view, entry.path)
    if (v == null) return
    const nf: Keyframe = {
      t: +Math.min(segLen, Math.max(0, t)).toFixed(3),
      value: v,
      easing: 'linear'
    }
    const next = [...frames.filter((f) => Math.abs(f.t - nf.t) > 0.01), nf].sort(
      (a, b) => a.t - b.t
    )
    setFrames(next)
    setSelPoint(next.findIndex((f) => f.t === nf.t && f.value === nf.value))
  }
}
