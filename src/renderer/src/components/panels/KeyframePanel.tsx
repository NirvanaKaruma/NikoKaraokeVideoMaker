import { useRef, useState } from 'react'
import type { ProjectLayout } from '@shared/layout'
import {
  KEYFRAME_CATALOG,
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
  /** 总时长（全局轨道打帧边界；片段模式取段长） */
  durationSec: number
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
  /** P3a 目录分组折叠：默认收起无帧的组，有帧的组展开 */
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const stripRef = useRef<HTMLDivElement>(null)

  /** 片段模式 = 段长；全局模式（未选段）= 整曲时长（1.1.0 #3） */
  const segLen = Math.max(
    0.1,
    props.segId ? props.segEndSec - props.segStartSec : props.durationSec
  )
  /**
   * 附加图层（overlay）动态关键帧条目（用户需求：新加的图/元素也能单独打关键帧）：
   * 路径按数组索引定位（overlayLayers.<i>.rect.x …），i18n 标签 = 图层 {i} · 字段。
   * 已知限制：层删除/重排后旧路径失配（v1 记录，后续可改用稳定层 id 路径协议）。
   */
  const overlayEntries: (KeyframeCatalogEntry & { dynamic: true; idx: number })[] = (
    props.view.overlayLayers ?? []
  ).flatMap((_o, idx) => {
    const b = 'overlayLayers.' + idx + '.'
    const mk = (
      path: string,
      labelKey: string,
      kind: 'number' | 'color',
      min: number,
      max: number,
      step: number,
      displayScale?: number
    ): KeyframeCatalogEntry & { dynamic: true; idx: number } => ({
      path,
      labelKey,
      kind,
      min,
      max,
      step,
      displayScale,
      dynamic: true,
      idx
    })
    return [
      mk(b + 'rect.x', 'kf.ovX', 'number', 0, 1, 0.001, 100),
      mk(b + 'rect.y', 'kf.ovY', 'number', 0, 1, 0.001, 100),
      mk(b + 'rect.w', 'kf.ovW', 'number', 0.01, 1, 0.001, 100),
      mk(b + 'rect.h', 'kf.ovH', 'number', 0.01, 1, 0.001, 100),
      mk(b + 'opacity', 'kf.ovOpacity', 'number', 0, 1, 0.01, 100),
      mk(b + 'fx.breathe', 'kf.ovBreathe', 'number', 0, 1, 0.01, 100),
      mk(b + 'fx.rotateDeg', 'kf.ovRotate', 'number', -45, 45, 0.5),
      mk(b + 'fx.glowPulse', 'kf.ovGlow', 'number', 0, 1, 0.01, 100)
    ]
  })
  const allEntries: KeyframeCatalogEntry[] = [...KEYFRAME_CATALOG, ...overlayEntries]
  const entry = selPath ? (allEntries.find((c) => c.path === selPath) ?? null) : null
  const track = selPath ? (props.tracks.find((x) => x.path === selPath) ?? null) : null
  const frames = track?.frames ?? []

  /** 相对播放头（裁剪到片段内） */
  const relT = Math.min(
    segLen,
    Math.max(0, props.segId ? props.currentT - props.segStartSec : props.currentT)
  )

  /** 写帧（轨道不存在时自动创建——修复「添加关键帧」静默失效） */
  const setFrames = (next: Keyframe[]): void => {
    if (!selPath) return
    const sorted = [...next].sort((a, b) => a.t - b.t)
    if (track) {
      props.onTracksChange(
        props.tracks.map((x) => (x.path === selPath ? { ...x, frames: sorted } : x))
      )
    } else {
      props.onTracksChange([...props.tracks, { path: selPath, frames: sorted }])
    }
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

  /** 批量打帧（1.1.0 用户 #1）：当前播放头处为**全部已参与动画的属性**各写一帧（改完多个属性 → 一次定格） */
  const batchAdd = (): void => {
    const tt = +relT.toFixed(3)
    const nextTracks = props.tracks.map((tr): PropertyTrack => {
      const v = currentValueAt(props.view, tr.path)
      if (v == null) return tr
      const filtered = tr.frames.filter((f) => Math.abs(f.t - tt) > 0.01)
      return {
        ...tr,
        frames: [...filtered, { t: tt, value: v, easing: 'linear' as EasingName }].sort(
          (a, b) => a.t - b.t
        )
      }
    })
    props.onTracksChange(nextTracks)
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

  /** P3a 目录分组：折叠展示（有帧组默认展开；未选段 = 全局基线模式，同样可打帧） */
  const GROUPS: { id: string; labelKey: string; test: (p: string) => boolean }[] = [
    { id: 'text', labelKey: 'kf.groupText', test: (p) => p.startsWith('texts.') },
    { id: 'image', labelKey: 'kf.groupImage', test: (p) => p.startsWith('mainImage.') },
    { id: 'bg', labelKey: 'kf.groupBg', test: (p) => p.startsWith('background.') },
    { id: 'viz', labelKey: 'kf.groupViz', test: (p) => p.startsWith('visualizer.') },
    { id: 'overlay', labelKey: 'kf.groupOverlay', test: (p) => p.startsWith('overlayLayers.') }
  ]

  return (
    <div className="kf-panel">
      <div className="panel-note">{props.segId ? t('kf.hint') : t('kf.hintGlobal')}</div>
      {/* 轨道清单（分组折叠） */}
      {GROUPS.map((gr) => {
        const entriesG = allEntries.filter((c) => gr.test(c.path))
        if (entriesG.length === 0) return null
        const hasFrames = entriesG.some((c) =>
          props.tracks.some((x) => x.path === c.path && x.frames.length > 0)
        )
        const open = openGroups[gr.id] ?? hasFrames
        return (
          <div className="kf-group" key={gr.id}>
            <button
              type="button"
              className="kf-group-head"
              onClick={() => setOpenGroups((s) => ({ ...s, [gr.id]: !open }))}
            >
              <span>
                {open ? '▾ ' : '▸ '}
                {t(gr.labelKey)}
              </span>
              {hasFrames && <span className="kf-dot">◆</span>}
            </button>
            {open && (
              <div className="kf-track-list">
                {entriesG.map((c) => {
                  const has = props.tracks.some((x) => x.path === c.path && x.frames.length > 0)
                  const dyn = c as KeyframeCatalogEntry & { dynamic?: boolean; idx?: number }
                  const label = dyn.dynamic
                    ? t('overlay.layerI', { i: (dyn.idx ?? 0) + 1 }) + ' · ' + t(c.labelKey)
                    : t(c.labelKey)
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
                      <span>{label}</span>
                      {has && <span className="kf-dot">◆</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
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
            {props.tracks.length > 0 && (
              <button type="button" className="btn-sm" onClick={batchAdd}>
                {t('kf.batchAdd')}
              </button>
            )}
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
                      /^#[0-9a-fA-F]{6}$/.test(String(sel.value)) ? String(sel.value) : '#000000'
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
