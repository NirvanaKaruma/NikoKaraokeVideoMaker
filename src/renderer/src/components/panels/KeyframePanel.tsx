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
  /** 选中的关键帧时间（帧级编辑器；同时间的属性帧合并为一个关键帧） */
  const [selT, setSelT] = useState<number | null>(null)
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

  /** —— 帧级编辑辅助（统一编辑器） —— */
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 0.01
  const allFrameTs: number[] = [
    ...new Set(props.tracks.flatMap((tr) => tr.frames.map((f) => +f.t.toFixed(3))))
  ].sort((a, b) => a - b)
  const frameEntriesAt = (
    tt: number
  ): { path: string; frame: Keyframe; entry: KeyframeCatalogEntry }[] => {
    const out: { path: string; frame: Keyframe; entry: KeyframeCatalogEntry }[] = []
    for (const tr of props.tracks) {
      const fr = tr.frames.find((f) => near(f.t, tt))
      if (!fr) continue
      const en = allEntries.find((c) => c.path === tr.path)
      if (!en) continue
      out.push({ path: tr.path, frame: fr, entry: en })
    }
    return out
  }
  const framePropLabel = (path: string): string => {
    const c = allEntries.find((x) => x.path === path)
    if (!c) return path
    const dyn = c as KeyframeCatalogEntry & { dynamic?: boolean; idx?: number }
    return dyn.dynamic
      ? t('overlay.layerI', { i: (dyn.idx ?? 0) + 1 }) + ' · ' + t(c.labelKey)
      : t(c.labelKey)
  }
  const updateAll = (next: PropertyTrack[]): void => props.onTracksChange(next)
  const setFrameValueAt = (path: string, tt: number, v: number | string): void =>
    updateAll(
      props.tracks.map((tr) =>
        tr.path !== path
          ? tr
          : { ...tr, frames: tr.frames.map((f) => (near(f.t, tt) ? { ...f, value: v } : f)) }
      )
    )
  const setFrameEasingAt = (path: string, tt: number, easing: EasingName): void =>
    updateAll(
      props.tracks.map((tr) =>
        tr.path !== path
          ? tr
          : { ...tr, frames: tr.frames.map((f) => (near(f.t, tt) ? { ...f, easing } : f)) }
      )
    )
  const setFramePropRemove = (path: string, tt: number): void =>
    updateAll(
      props.tracks
        .map((tr) =>
          tr.path !== path ? tr : { ...tr, frames: tr.frames.filter((f) => !near(f.t, tt)) }
        )
        .filter((tr) => tr.frames.length > 0)
    )
  const removeFrameAt = (tt: number): void =>
    updateAll(
      props.tracks
        .map((tr) => ({ ...tr, frames: tr.frames.filter((f) => !near(f.t, tt)) }))
        .filter((tr) => tr.frames.length > 0)
    )
  const addPropAt = (path: string, tt: number): void => {
    const raw = currentValueAt(props.view, path)
    if (raw == null) return
    const frame: Keyframe = { t: tt, value: raw, easing: 'linear' }
    const existing = props.tracks.find((tr) => tr.path === path)
    if (existing) {
      updateAll(
        props.tracks.map((tr) =>
          tr.path !== path
            ? tr
            : {
                ...tr,
                frames: [...tr.frames.filter((f) => !near(f.t, tt)), frame].sort(
                  (a, b) => a.t - b.t
                )
              }
        )
      )
    } else {
      updateAll([...props.tracks, { path, frames: [frame] }])
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
    setSelT(nf.t)
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
                        const fs = framesOf(props.tracks, c.path)
                        if (fs.length > 0) setSelT(fs[fs.length - 1].t)
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
          {/* 关键帧点条（全帧聚合：同时间的属性帧显示为一个点——动画软件式） */}
          {allFrameTs.length > 0 ? (
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
              {allFrameTs.map((tt, i) => (
                <div
                  key={i}
                  className={
                    'kf-point' + (selT != null && Math.abs(selT - tt) < 0.01 ? ' active' : '')
                  }
                  style={{ left: (tt / segLen) * 100 + '%' }}
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelT(tt)
                  }}
                  title={t('kf.frameTitle', { t: tt.toFixed(2), n: frameEntriesAt(tt).length })}
                />
              ))}
            </div>
          ) : (
            <div className="kf-strip empty">{t('kf.noPoint')}</div>
          )}
          {/* 帧级编辑器：点选关键帧 → 该时刻全部属性的统一查看/修改/删除（用户方向） */}
          {selT != null && (
            <div className="kf-frame-editor">
              <div className="kf-frame-head">
                <span className="kf-time">
                  t={selT.toFixed(2)}s · {frameEntriesAt(selT).length} {t('kf.props')}
                </span>
                <button
                  type="button"
                  className="btn-sm danger"
                  onClick={() => {
                    removeFrameAt(selT)
                    setSelT(null)
                  }}
                >
                  {t('kf.removeFrame')}
                </button>
              </div>
              {frameEntriesAt(selT).map(({ path, frame: fr, entry: en }, i) => (
                <div className="kf-frame-row" key={i}>
                  <span className="kf-frame-name">{framePropLabel(path)}</span>
                  {en.kind === 'number' ? (
                    <input
                      className="kf-num"
                      type="number"
                      step={en.step * (en.displayScale ?? 1)}
                      value={displayOf(fr.value as number, en)}
                      onChange={(ev) => {
                        const n2 = Number(ev.target.value)
                        if (Number.isFinite(n2)) setFrameValueAt(path, selT, rawOf(n2, en))
                      }}
                    />
                  ) : (
                    <span className="kf-color">
                      <input
                        type="color"
                        value={
                          /^#[0-9a-fA-F]{6}$/.test(String(fr.value)) ? String(fr.value) : '#000000'
                        }
                        onChange={(ev) => setFrameValueAt(path, selT, ev.target.value)}
                      />
                      <input
                        className="kf-num"
                        type="text"
                        value={String(fr.value)}
                        onChange={(ev) => setFrameValueAt(path, selT, ev.target.value)}
                      />
                    </span>
                  )}
                  <select
                    className="kf-select"
                    value={fr.easing}
                    onChange={(ev) => setFrameEasingAt(path, selT, ev.target.value as EasingName)}
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
                    title={t('kf.removeProp')}
                    onClick={() => setFramePropRemove(path, selT)}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div className="kf-frame-add">
                <select
                  className="kf-select"
                  value=""
                  onChange={(ev) => {
                    const p = ev.target.value
                    if (p) {
                      addPropAt(p, selT)
                      ev.target.value = ''
                    }
                  }}
                >
                  <option value="">{t('kf.addProp')}</option>
                  {allEntries
                    .filter((c) => !frameEntriesAt(selT).some((x) => x.path === c.path))
                    .map((c) => (
                      <option key={c.path} value={c.path}>
                        {framePropLabel(c.path)}
                      </option>
                    ))}
                </select>
              </div>
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
    setSelT(nf.t)
  }
}
