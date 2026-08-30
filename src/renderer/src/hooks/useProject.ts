import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioEngineConfig,
  BackgroundConfig,
  BeatFxConfig,
  CanvasFxConfig,
  DEFAULT_LAYOUT,
  EditorConfig,
  ExportConfig,
  IntroOutroConfig,
  LayerItem,
  MainImageConfig,
  NormRect,
  OverlayLayerConfig,
  ProjectLayout,
  TextLayerConfig,
  VisualizerConfig,
  defaultLayerOrder
} from '@shared/layout'
import {
  clampSegmentBoundsToNeighbors,
  clampSegmentsToDuration,
  getByPath,
  splitTimelineAt,
  type CutTransitionSpec,
  type Keyframe,
  type PropertyTrack
} from '@shared/timeline'
import {
  catalogEntry,
  collectKeyframePaths,
  firstChangedKeyframePath
} from '@shared/keyframeCatalog'
import type { ProjectFile } from '@shared/project'
import { t } from '@shared/i18n'

/** 图像源元素统一类型：解码后的 Image 或"超大图缩放后的 Canvas"（Konva 均可绘制） */
export type CanvasImageElement = HTMLImageElement | HTMLCanvasElement

export const COVER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
/** 音频 + 可提取音轨的视频（预览解码由 Chromium 支持，导出由 ffmpeg 提取音轨） */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'mp4', 'm4v', 'mov', 'webm']

export interface ProjectAssets {
  coverUrl: string | null
  coverFile: File | null
  /** 已解码的封面图像（HTMLImageElement；超大图则缩放为 HTMLCanvasElement；Konva 绘制用） */
  coverElement: CanvasImageElement | null
  /** 独立背景图（用户额外上传，替代封面做背景后处理） */
  bgUrl: string | null
  bgFile: File | null
  bgElement: CanvasImageElement | null
  audioUrl: string | null
  audioFile: File | null
  /** 附加图像层资产（0.8.0）：layerId → 图像（url/file/解码元素）；与 layout.overlayLayers 平行 */
  overlayImages: Record<
    string,
    { url: string | null; file: File | null; element: CanvasImageElement | null }
  >
  /** 自定义字体文件（0.8.0，路径引用不入 JSON；null = 未选择） */
  fontFile: File | null | undefined
}

const EMPTY_ASSETS: ProjectAssets = {
  coverUrl: null,
  coverFile: null,
  coverElement: null,
  bgUrl: null,
  bgFile: null,
  bgElement: null,
  audioUrl: null,
  audioFile: null,
  overlayImages: {},
  fontFile: null
}

/** 大图解码上限（长边像素）：超过则在解码后缩放一次——12MP 原图直接给 Konva
 * 会造成纹理上传/绘制卡顿（导入冻结）。3200px 覆盖 2K（2560）无缩放损失，
 * 仅对 4K 导出有轻微收紧（4K 图源本就常需放大，视觉影响可忽略）。 */
const MAX_IMAGE_EDGE = 3200

/** 解码后按上限缩放（保持透明通道；≤上限则原样返回） */
function capImage(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (Math.max(iw, ih) <= MAX_IMAGE_EDGE || iw <= 0 || ih <= 0) return img
  const s = MAX_IMAGE_EDGE / Math.max(iw, ih)
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(iw * s))
  c.height = Math.max(1, Math.round(ih * s))
  const ctx = c.getContext('2d')
  if (ctx) ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

/** 统一快照：脏比较与保存点写入共用同一构建逻辑（防止字段漂移） */
function snapshotOf(l: ProjectLayout, a: ProjectAssets): string {
  return JSON.stringify({
    layout: l,
    hasCover: a.coverUrl != null,
    hasBg: a.bgUrl != null,
    hasAudio: a.audioUrl != null,
    // 附加层图像存在性（按 id 稳定序列化——URL 是 objectURL 每次加载会变，只能比"有没有"）
    hasFont: a.fontFile != null,
    overlays: Object.keys(a.overlayImages ?? {})
      .sort()
      .map((id) => id + ':' + (a.overlayImages[id].element != null ? 1 : 0))
      .join(',')
  })
}

/**
 * 项目状态：归一化布局（唯一数据源）+ 输入资产。
 * 预览与导出都从这份状态读取，保证所见即所得（核心约束 A）。
 */
export function useProject(): {
  layout: ProjectLayout
  /** 当前编辑视图（1.0.0 T4）：段视图或全局基线 */
  view: ProjectLayout
  /** 当前编辑目标（1.0.0 T4）：null=全局基线，否则片段 id */
  editSegId: string | null
  /** 1-based 片段序号（0=全局，1.0.0 T4） */
  editSegIndex: number
  setEditSegment: (id: string | null) => void
  /** PR 式面板 auto-keyframe：同步当前播放头（面板改可关键帧属性 → 写播放头处帧） */
  setKfCurT: (t: number | null) => void
  /** 自动创建关键帧开关（默认 true：面板任何可关键帧属性修改立即建/写帧） */
  setKfAuto: (on: boolean) => void
  assets: ProjectAssets
  fileError: string | null
  notice: string | null
  updateBackground: (patch: Partial<BackgroundConfig>) => void
  updateMainRect: (rect: NormRect) => void
  updateMainImage: (patch: Partial<MainImageConfig>) => void
  updateText: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => void
  /** 全局直达文本更新（1.0.0 T4：歌曲信息输入栏不随编辑目标路由） */
  updateTextGlobal: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => void
  updateVisualizer: (patch: Partial<VisualizerConfig>) => void
  updateBackgroundFx: (patch: Partial<BackgroundConfig['fx']>) => void
  updateImageFx: (patch: Partial<MainImageConfig['fx']>) => void
  updateTextEntry: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig['entry']>) => void
  updateCanvasFx: (patch: Partial<CanvasFxConfig>) => void
  updateIntroOutro: (patch: Partial<IntroOutroConfig>) => void
  updateBeatFx: (patch: Partial<BeatFxConfig>) => void
  updateAudioEngine: (patch: Partial<AudioEngineConfig>) => void
  updateExport: (patch: Partial<ExportConfig>) => void
  setCoverFile: (file: File | null) => void
  setCoverFromUrl: (url: string) => void
  /** 附加层图像（0.8.0）：设置/清除某层图像；file=null 清除 */
  setOverlayFile: (id: string, file: File | null) => void
  /** 附加层图像：从 dataURL 恢复（打开项目时用） */
  setOverlayFromUrl: (id: string, url: string) => void
  /** 自定义字体文件（0.8.0）：null = 清除 */
  setFontFile: (file: File | null) => void
  /** 附加层：新增（默认右下角/水印位），返回新层 id */
  addOverlayLayer: () => string
  /** 附加层：改配置（rect/opacity/fx/entry） */
  updateOverlayLayer: (id: string, patch: Partial<OverlayLayerConfig>) => void
  /** 附加层：删除（连同其图像资产） */
  removeOverlayLayer: (id: string) => void
  /** 附加层：z 序上移/下移（-1=上，1=下） */
  moveOverlayLayer: (id: string, dir: -1 | 1) => void
  /** 1.0.0 时间轴段级 API */
  getSegmentLayoutView: (segId: string) => ProjectLayout
  updateSegmentLayout: (segId: string, patch: Partial<ProjectLayout>) => void
  addSegment: (startSec: number, endSec: number) => string
  removeSegment: (segId: string) => void
  splitSegment: (atSec: number, durationSec?: number) => void
  updateSegmentBounds: (segId: string, startSec: number, endSec: number) => void
  /** 段属性过渡（v4：过渡属于段落本身；boundary='in' 段首淡入 | 'out' 段尾淡出；patch = 时长/曲线，0–3s 钳制） */
  updateSegmentTransition: (
    segId: string,
    boundary: 'in' | 'out',
    patch: Partial<CutTransitionSpec>
  ) => void
  /** 段关键帧整体替换（T5；t 相对片段起点） */
  updateSegmentTracks: (segId: string, tracks: PropertyTrack[]) => void
  /** 全局基线关键帧整体替换（1.1.0 #3；t 绝对秒） */
  updateDocKeyframes: (tracks: PropertyTrack[]) => void
  /** 裸创建关键帧（空帧槽；segId=null → 全局） */
  addEmptyFrame: (segId: string | null, atSec: number) => void
  /** 空帧槽整体替换（段内 t 相对段起点） */
  updateFrameSlots: (segId: string | null, slots: number[]) => void
  /** 音频长度变化边界修正（T9；无改动时 no-op 不入历史） */
  clampTimelineToDuration: (durationSec: number) => void
  applySegmentToAll: (segId: string) => void
  /** 图层（0.9.0）：隐藏/锁定切换（None-null 时物化默认序） */
  updateLayerState: (id: string, patch: Partial<Pick<LayerItem, 'hidden' | 'locked'>>) => void
  /** 图层（0.9.0）：z 序上移/下移 */
  moveLayerState: (id: string, dir: -1 | 1) => void
  /** 编辑器选项（0.9.0）：吸附开关等 */
  updateEditor: (patch: Partial<EditorConfig>) => void
  setAudioFile: (file: File | null) => void
  setBgFile: (file: File | null) => void
  clearBgImage: () => void
  saveProject: () => Promise<boolean>
  loadProject: () => Promise<void>
  resetProject: () => void
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
  /** 是否有未保存修改（布局/素材相对最近一次保存/加载/新建） */
  dirty: boolean
  clearNotice: () => void
  buildProjectFile: () => Promise<ProjectFile>
  applyProjectFile: (pf: ProjectFile) => Promise<string[]>
} {
  const [layout, setLayout] = useState<ProjectLayout>(() => structuredClone(DEFAULT_LAYOUT))
  const [assets, setAssets] = useState<ProjectAssets>(EMPTY_ASSETS)
  const [fileError, setFileError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const layoutRef = useRef(layout)
  const assetsRef = useRef(assets)
  /** 撤销/重做历史（布局快照 JSON 栈；用 ref + 版本号驱动按钮状态） */
  const pastRef = useRef<string[]>([])
  const futureRef = useRef<string[]>([])
  const [histLen, setHistLen] = useState({ past: 0, future: 0 })
  /** 最近一次保存/加载/新建时的快照（判断未保存修改） */
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() => snapshotOf(layout, EMPTY_ASSETS))

  useEffect(() => {
    layoutRef.current = layout
    assetsRef.current = assets
  }, [layout, assets])

  /** 脏标记：渲染期派生（快照字符串对比，不产生级联渲染） */
  const dirty = snapshotOf(layout, assets) !== savedSnapshot

  // ── 1.0.0 T4：编辑上下文化。编辑目标（null=全局基线）→ 所有布局写入路由（继承式写时复制）──
  const [editSegId, setEditSegIdState] = useState<string | null>(null)
  const editSegIdRef = useRef<string | null>(null)
  /** 设置/清除段级编辑目标（选择某片段 = 面板与画布进入该段视图） */
  const setEditSegment = useCallback((id: string | null) => {
    editSegIdRef.current = id
    setEditSegIdState(id)
  }, [])

  // PR 式面板 auto-keyframe：当前播放头（App 每帧同步）；面板改可关键帧属性 → 写播放头处帧
  const kfCurTRef = useRef<number | null>(null)
  const setKfCurT = useCallback((t: number | null) => {
    kfCurTRef.current = t
  }, [])
  /** 自动创建：面板改任何可关键帧属性 → 立即建/写帧（默认开；关=先打帧才接管） */
  const kfAutoRef = useRef(false)
  const setKfAuto = useCallback((on: boolean) => {
    kfAutoRef.current = on
  }, [])

  /** 当前编辑视图：段（未物化=全局快照）或全局基线；面板/画布只读此对象 */
  const editSegIndex = editSegId
    ? (layout.timeline?.segments ?? []).findIndex((s) => s.id === editSegId) + 1
    : 0
  const editSeg = editSegIndex > 0 ? (layout.timeline?.segments ?? [])[editSegIndex - 1] : null
  const view: ProjectLayout = editSeg?.layout ?? layout

  const bumpHistory = useCallback(() => {
    setHistLen({ past: pastRef.current.length, future: futureRef.current.length })
  }, [])

  /** 同步应用布局并更新 ref（保证连续操作的快照准确） */
  const applyLayout = useCallback((next: ProjectLayout) => {
    layoutRef.current = next
    setLayout(next)
  }, [])

  /** 提交前把当前布局压入撤销栈 */
  const pushHistory = useCallback(() => {
    pastRef.current.push(JSON.stringify(layoutRef.current))
    if (pastRef.current.length > 100) pastRef.current.shift()
    futureRef.current = []
    bumpHistory()
  }, [bumpHistory])

  /**
   * 提交布局补丁：路由到当前编辑目标。
   * 全局基线 → 直接应用；段视图 → 写时复制（base = seg.layout ?? 全局，首次改动自动物化「一改即拆」）。
   */
  const commit = useCallback(
    (fn: (l: ProjectLayout) => ProjectLayout) => {
      pushHistory()
      const base = layoutRef.current
      const segId = editSegIdRef.current
      const seg = segId ? (base.timeline?.segments ?? []).find((s) => s.id === segId) : null
      const viewBase = seg?.layout ?? base
      const next = fn(viewBase)
      // ── PR 式 auto-keyframe：可关键帧路径变更 → 写播放头处帧（自动开=首次即建帧；关=需已有轨道） ──
      const curT = kfCurTRef.current
      if (curT != null) {
        const changedPath = firstChangedKeyframePath(base, next, collectKeyframePaths(viewBase))
        if (changedPath != null && catalogEntry(changedPath)?.autoKf !== false) {
          const tracks = seg ? (seg.keyframes ?? []) : (base.timeline?.keyframes ?? [])
          const hasTrack = tracks.some((tr) => tr.path === changedPath && tr.frames.length > 0)
          if (kfAutoRef.current || hasTrack) {
            const v = getByPath(next, changedPath)
            if (typeof v === 'number' || typeof v === 'string') {
              const rel = seg ? Math.max(0, curT - seg.startSec) : curT
              const t = +rel.toFixed(3)
              const frame: Keyframe = { t, value: v, easing: 'linear' }
              let tracks2: PropertyTrack[]
              const exist = tracks.find((tr) => tr.path === changedPath)
              if (exist) {
                tracks2 = tracks.map((tr) =>
                  tr.path !== changedPath
                    ? tr
                    : {
                        ...tr,
                        frames: [...tr.frames.filter((f) => Math.abs(f.t - t) > 0.01), frame].sort(
                          (a, b) => a.t - b.t
                        )
                      }
                )
              } else {
                tracks2 = [...tracks, { path: changedPath, frames: [frame] }]
              }
              if (seg) {
                const segments = (base.timeline?.segments ?? []).map((s) =>
                  s.id === segId ? { ...s, keyframes: tracks2 } : s
                )
                applyLayout({ ...base, timeline: { ...base.timeline, segments } })
              } else {
                applyLayout({
                  ...base,
                  timeline: { ...(base.timeline ?? { segments: [] }), keyframes: tracks2 }
                })
              }
              return
            }
          }
        }
      }
      // ── 缺省：写基准（全局直改 或 段写时复制物化） ──
      if (!seg) {
        applyLayout(next)
        return
      }
      const segments = (base.timeline?.segments ?? []).map((s) =>
        s.id === segId ? { ...s, layout: next } : s
      )
      applyLayout({ ...base, timeline: { ...base.timeline, segments } })
    },
    [applyLayout, pushHistory]
  )

  const updateBackground = useCallback(
    (patch: Partial<BackgroundConfig>) => {
      commit((l) => ({ ...l, background: { ...l.background, ...patch } }))
    },
    [commit]
  )

  const updateMainRect = useCallback(
    (rect: NormRect) => {
      commit((l) => ({ ...l, mainImage: { ...l.mainImage, rect } }))
    },
    [commit]
  )

  const updateMainImage = useCallback(
    (patch: Partial<MainImageConfig>) => {
      commit((l) => ({ ...l, mainImage: { ...l.mainImage, ...patch } }))
    },
    [commit]
  )

  const updateText = useCallback(
    (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => {
      commit((l) => ({
        ...l,
        texts: { ...l.texts, [kind]: { ...l.texts[kind], ...patch } }
      }))
    },
    [commit]
  )

  /** 全局直达（1.0.0 T4）：歌曲标题/作者输入栏——项目元数据，不随编辑目标路由 */
  const updateTextGlobal = useCallback(
    (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        texts: {
          ...layoutRef.current.texts,
          [kind]: { ...layoutRef.current.texts[kind], ...patch }
        }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateVisualizer = useCallback(
    (patch: Partial<VisualizerConfig>) => {
      commit((l) => ({ ...l, visualizer: { ...l.visualizer, ...patch } }))
    },
    [commit]
  )

  const updateBackgroundFx = useCallback(
    (patch: Partial<BackgroundConfig['fx']>) => {
      commit((l) => ({
        ...l,
        background: { ...l.background, fx: { ...l.background.fx, ...patch } }
      }))
    },
    [commit]
  )

  const updateImageFx = useCallback(
    (patch: Partial<MainImageConfig['fx']>) => {
      commit((l) => ({
        ...l,
        mainImage: { ...l.mainImage, fx: { ...l.mainImage.fx, ...patch } }
      }))
    },
    [commit]
  )

  const updateTextEntry = useCallback(
    (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig['entry']>) => {
      commit((l) => ({
        ...l,
        texts: {
          ...l.texts,
          [kind]: { ...l.texts[kind], entry: { ...l.texts[kind].entry, ...patch } }
        }
      }))
    },
    [commit]
  )

  const updateCanvasFx = useCallback(
    (patch: Partial<CanvasFxConfig>) => {
      commit((l) => ({ ...l, canvasFx: { ...l.canvasFx, ...patch } }))
    },
    [commit]
  )

  const updateIntroOutro = useCallback(
    (patch: Partial<IntroOutroConfig>) => {
      commit((l) => ({ ...l, introOutro: { ...l.introOutro, ...patch } }))
    },
    [commit]
  )

  const updateBeatFx = useCallback(
    (patch: Partial<BeatFxConfig>) => {
      commit((l) => ({ ...l, beat: { ...l.beat, ...patch } }))
    },
    [commit]
  )

  const updateAudioEngine = useCallback(
    (patch: Partial<AudioEngineConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, audio: { ...layoutRef.current.audio, ...patch } })
    },
    [pushHistory, applyLayout]
  )

  const updateExport = useCallback(
    (patch: Partial<ExportConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, export: { ...layoutRef.current.export, ...patch } })
    },
    [pushHistory, applyLayout]
  )

  const loadCoverUrl = useCallback((url: string, file: File | null) => {
    setAssets((prev) => {
      if (prev.coverUrl) URL.revokeObjectURL(prev.coverUrl)
      return { ...prev, coverUrl: url, coverFile: file, coverElement: null }
    })
    const img = new Image()
    img.onload = () => setAssets((prev) => ({ ...prev, coverElement: capImage(img) }))
    img.onerror = () => setFileError(t('project.coverLoadFail'))
    img.src = url
  }, [])

  const setCoverFile = useCallback(
    (file: File | null) => {
      if (!file) return
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!COVER_EXTENSIONS.includes(ext)) {
        setFileError(t('project.coverType', { ext }))
        return
      }
      setFileError(null)
      loadCoverUrl(URL.createObjectURL(file), file)
    },
    [loadCoverUrl]
  )

  const setCoverFromUrl = useCallback(
    (url: string) => {
      setFileError(null)
      loadCoverUrl(url, null)
    },
    [loadCoverUrl]
  )

  // ── 0.8.0 附加图像层：资产（id 平行存放）与层 CRUD（z 序=数组序）──

  const loadOverlayUrl = useCallback((id: string, url: string, file: File | null) => {
    const iid = String(id)
    setAssets((prev) => {
      const old = prev.overlayImages?.[iid]
      if (old?.url) URL.revokeObjectURL(old.url)
      return {
        ...prev,
        overlayImages: { ...(prev.overlayImages ?? {}), [iid]: { url, file, element: null } }
      }
    })
    const img = new Image()
    img.onload = () =>
      setAssets((prev) => ({
        ...prev,
        overlayImages: {
          ...(prev.overlayImages ?? {}),
          [iid]: {
            url,
            file,
            element: capImage(img)
          }
        }
      }))
    img.onerror = () => setFileError(t('project.overlayLoadFail'))
    img.src = url
  }, [])

  const setOverlayFile = useCallback(
    (id: string, file: File | null) => {
      const iid = String(id)
      if (!file) {
        setAssets((prev) => {
          const old = prev.overlayImages?.[iid]
          if (old?.url) URL.revokeObjectURL(old.url)
          const next = { ...(prev.overlayImages ?? {}) }
          delete next[iid]
          return { ...prev, overlayImages: next }
        })
        return
      }
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!COVER_EXTENSIONS.includes(ext)) {
        setFileError(t('project.overlayType', { ext }))
        return
      }
      setFileError(null)
      loadOverlayUrl(iid, URL.createObjectURL(file), file)
    },
    [loadOverlayUrl]
  )

  const setOverlayFromUrl = useCallback(
    (id: string, url: string) => loadOverlayUrl(String(id), url, null),
    [loadOverlayUrl]
  )

  const overlayDefaults = useCallback((): OverlayLayerConfig => {
    return {
      id: crypto.randomUUID(),
      // 默认落位：右下角（水印位），用户可拖/摆位
      rect: { x: 0.7, y: 0.66, w: 0.2, h: 0.15 },
      opacity: 1,
      fx: {
        breathe: 0,
        breathePeriod: 4,
        rotateDeg: 0,
        glowPulse: 0,
        mask: 'none',
        border: 0,
        borderColor: '#ffffff'
      },
      entry: { type: 'none', durationSec: 1.2, delaySec: 0 },
      fillMode: 'contain'
    }
  }, [])

  /** 图层清单物化（0.9.0）：layers=null 时按默认序展开；已有清单则补入缺失项（如新附加层） */
  const materializeLayers = useCallback((cur: ProjectLayout): LayerItem[] => {
    const def = defaultLayerOrder((cur.overlayLayers ?? []).map((o) => 'overlay:' + o.id))
    if (!cur.layers) return def.map((id) => ({ id, hidden: false, locked: false }))
    const ids = new Set(cur.layers.map((x) => x.id))
    const missing = def.filter((id) => !ids.has(id))
    if (missing.length === 0) return cur.layers
    const out = [...cur.layers]
    const mi = out.findIndex((x) => x.id === 'main')
    out.splice(
      mi < 0 ? out.length : mi + 1,
      0,
      ...missing.map((id) => ({ id, hidden: false, locked: false }))
    )
    return out
  }, [])

  /**
   * P1 结构操作全局化（用户 #5）：图层的增/删/排序 = 全局结构（各段快照同步镜像），
   * 不再随段级编辑目标路由——删除不再"只删本段"导致跨段残留/资产泄漏。
   * 隐藏/锁定/参数值仍保持段级可差异化。
   */
  const mirrorSegments = (
    fn: (l: ProjectLayout) => ProjectLayout
  ): ProjectLayout['timeline'] | undefined => {
    const cur = layoutRef.current
    if (!cur.timeline?.segments?.length) return undefined
    const hasMat = cur.timeline.segments.some((s) => s.layout != null)
    if (!hasMat) return undefined
    return {
      ...cur.timeline,
      segments: cur.timeline.segments.map((s) => (s.layout ? { ...s, layout: fn(s.layout) } : s))
    }
  }

  const addOverlayLayer = useCallback((): string => {
    const layer = overlayDefaults()
    pushHistory()
    const cur = layoutRef.current
    const addTo = (l: ProjectLayout): ProjectLayout => ({
      ...l,
      overlayLayers: [...l.overlayLayers, layer],
      layers: l.layers
        ? materializeLayers({ ...l, overlayLayers: [...l.overlayLayers, layer] })
        : null
    })
    const next = addTo(cur)
    const tl = mirrorSegments(addTo)
    applyLayout(tl ? { ...next, timeline: tl } : next)
    return layer.id
  }, [applyLayout, materializeLayers, overlayDefaults, pushHistory])

  const updateOverlayLayer = useCallback(
    (id: string, patch: Partial<OverlayLayerConfig>) => {
      commit((l) => ({
        ...l,
        overlayLayers: l.overlayLayers.map((o) => (o.id === id ? { ...o, ...patch, id: o.id } : o))
      }))
    },
    [commit]
  )

  const removeOverlayLayer = useCallback(
    (id: string) => {
      pushHistory()
      const cur = layoutRef.current
      const strip = (l: ProjectLayout): ProjectLayout => ({
        ...l,
        overlayLayers: l.overlayLayers.filter((o) => o.id !== id),
        layers: l.layers ? l.layers.filter((x) => x.id !== 'overlay:' + id) : null
      })
      const next = strip(cur)
      const tl = mirrorSegments(strip)
      applyLayout(tl ? { ...next, timeline: tl } : next)
      setAssets((prev) => {
        const old = prev.overlayImages?.[id]
        if (old?.url) URL.revokeObjectURL(old.url)
        const n2 = { ...(prev.overlayImages ?? {}) }
        delete n2[id]
        return { ...prev, overlayImages: n2 }
      })
    },
    [applyLayout, pushHistory]
  )

  const moveOverlayLayer = useCallback(
    (id: string, dir: -1 | 1) => {
      const mover = (cur: ProjectLayout): ProjectLayout => {
        const arr = [...cur.overlayLayers]
        const i = arr.findIndex((o) => o.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= arr.length) return cur
        const tmp = arr[i]
        arr[i] = arr[j]
        arr[j] = tmp
        // 已物化图层清单：同步交换两个附加层条目（保持与 overlayLayers 数组序一致）
        let layers = cur.layers
        if (layers) {
          const la = layers.findIndex((x) => x.id === 'overlay:' + arr[i].id)
          const lb = layers.findIndex((x) => x.id === 'overlay:' + arr[j].id)
          if (la >= 0 && lb >= 0) {
            const out = [...layers]
            const tt = out[la]
            out[la] = out[lb]
            out[lb] = tt
            layers = out
          }
        }
        return { ...cur, overlayLayers: arr, layers }
      }
      pushHistory()
      const cur = layoutRef.current
      const next = mover(cur)
      const tl = mirrorSegments(mover)
      applyLayout(tl ? { ...next, timeline: tl } : next)
    },
    [applyLayout, pushHistory]
  )

  /** 0.9.0：图层隐藏/锁定（首次编辑物化清单） */
  const updateLayerState = useCallback(
    (id: string, patch: Partial<Pick<LayerItem, 'hidden' | 'locked'>>) => {
      commit((cur) => {
        const next = materializeLayers(cur)
        const hit = next.find((x) => x.id === id)
        if (hit) {
          Object.assign(hit, patch)
        } else {
          next.push({ id, hidden: patch.hidden ?? false, locked: patch.locked ?? false })
        }
        return { ...cur, layers: next }
      })
    },
    [commit, materializeLayers]
  )

  /** 0.9.0：图层 z 序上移/下移 */
  const moveLayerState = useCallback(
    (id: string, dir: -1 | 1) => {
      commit((cur) => {
        const arr = materializeLayers(cur)
        const i = arr.findIndex((x) => x.id === id)
        const j = i + dir
        if (i < 0 || j < 0 || j >= arr.length) return cur
        const tmp = arr[i]
        arr[i] = arr[j]
        arr[j] = tmp
        return { ...cur, layers: arr }
      })
    },
    [commit, materializeLayers]
  )

  /** 0.9.0：编辑器选项（吸附开关等） */
  const updateEditor = useCallback(
    (patch: Partial<EditorConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, editor: { ...layoutRef.current.editor, ...patch } })
    },
    [applyLayout, pushHistory]
  )

  // ── 1.0.0 时间轴：继承式全局基线（写时复制——改某段即物化）──

  /** 段视图：该段布局（null=继承）或全局基线（面板读取用） */
  const getSegmentLayoutView = useCallback((segId: string): ProjectLayout => {
    const seg = (layoutRef.current.timeline?.segments ?? []).find((s) => s.id === segId)
    return seg?.layout ?? layoutRef.current
  }, [])

  /** 段更新：写时复制——改为段视图 + patch，然后物化存回 seg.layout（其余段不受影响） */
  const updateSegmentLayout = useCallback(
    (segId: string, patch: Partial<ProjectLayout>) => {
      pushHistory()
      const cur = layoutRef.current
      const segments = (cur.timeline?.segments ?? []).map((s) =>
        s.id === segId ? { ...s, layout: { ...(s.layout ?? cur), ...patch } } : s
      )
      applyLayout({ ...cur, timeline: { segments } })
    },
    [applyLayout, pushHistory]
  )

  const addSegment = useCallback(
    (startSec: number, endSec: number): string => {
      pushHistory()
      const cur = layoutRef.current
      const id = crypto.randomUUID()
      const segments = [
        ...(cur.timeline?.segments ?? []),
        { id, startSec, endSec, layout: null, keyframes: [] as PropertyTrack[] }
      ].sort((a, b) => a.startSec - b.startSec)
      applyLayout({ ...cur, timeline: { segments } })
      return id
    },
    [applyLayout, pushHistory]
  )

  const removeSegment = useCallback(
    (segId: string) => {
      pushHistory()
      const cur = layoutRef.current
      applyLayout({
        ...cur,
        timeline: { segments: (cur.timeline?.segments ?? []).filter((s) => s.id !== segId) }
      })
    },
    [applyLayout, pushHistory]
  )

  /**
   * 分割：atSec（绝对）把所在段切成两段（布局继承/克隆；关键帧按相对时间拆轨平移）。
   * 1.0.0 UX 修复：**无任何片段时** = 整首是全局基线——此时分割 = 把整首切成两段
   * （[0,at) / [at,dur)，均 layout:null 继承全局，视觉不变但可分别编辑（主歌/副歌场景）。
   */
  const splitSegment = useCallback(
    (atSec: number, durationSec?: number) => {
      const cur = layoutRef.current
      // 纯函数（含无片段=整首切两段；连续多次分割无重叠——单测覆盖）
      const res = splitTimelineAt({ segments: cur.timeline?.segments ?? [] }, atSec, durationSec)
      if (!res.changed) return
      // 段属性过渡（v4）：属于段落本身 → 分割时左半段保留 transitionIn、右半段保留 transitionOut
      // （与「进入随左、离开随右」的自然直觉一致；新内边界默认硬切）
      const origId = (cur.timeline?.segments ?? []).find(
        (s) => atSec > s.startSec && atSec < s.endSec
      )?.id
      const segments = res.segments.map((s) =>
        s.id === origId
          ? { ...s, transitionOut: undefined }
          : s.startSec >= atSec
            ? { ...s, transitionIn: undefined }
            : s
      )
      pushHistory()
      applyLayout({
        ...cur,
        timeline: { ...(cur.timeline ?? { segments: [] }), segments }
      })
    },
    [applyLayout, pushHistory]
  )

  /** 边界调整（move/resize）：钳制到相邻段（用户反馈"段间重叠"——不再允许侵入；保留 0.05s 最小缝） */
  const updateSegmentBounds = useCallback(
    (segId: string, startSec: number, endSec: number) => {
      pushHistory()
      const cur = layoutRef.current
      const curSegs = cur.timeline?.segments ?? []
      const [a, b] = clampSegmentBoundsToNeighbors(curSegs, segId, startSec, endSec)
      const segments = curSegs
        .map((s) => (s.id === segId ? { ...s, startSec: a, endSec: b } : s))
        .sort((x, y) => x.startSec - y.startSec)
      applyLayout({ ...cur, timeline: { segments } })
    },
    [applyLayout, pushHistory]
  )

  /** 段属性过渡（v4，过渡属于段落本身——改长度/增删相邻段都不失效）：
   * boundary='in' 段首淡入（全局→段）| 'out' 段尾淡出（段→全局）；patch = 时长/曲线；
   * 时长 0–3s，<0.05 视为未配置 → 删除（快路径/序列化干净）；easing 默认 linear */
  const updateSegmentTransition = useCallback(
    (segId: string, boundary: 'in' | 'out', patch: Partial<CutTransitionSpec>) => {
      pushHistory()
      const cur = layoutRef.current
      const segments = (cur.timeline?.segments ?? []).map((s) => {
        if (s.id !== segId) return s
        const prev = boundary === 'in' ? s.transitionIn : s.transitionOut
        const spec: CutTransitionSpec = {
          durationSec: Number.isFinite(patch.durationSec)
            ? Math.min(3, Math.max(0, patch.durationSec as number))
            : (prev?.durationSec ?? 0),
          easing: patch.easing ?? prev?.easing ?? 'linear'
        }
        if (spec.durationSec >= 0.05) {
          return boundary === 'in' ? { ...s, transitionIn: spec } : { ...s, transitionOut: spec }
        }
        return boundary === 'in'
          ? { ...s, transitionIn: undefined }
          : { ...s, transitionOut: undefined }
      })
      applyLayout({ ...cur, timeline: { ...(cur.timeline ?? { segments: [] }), segments } })
    },
    [applyLayout, pushHistory]
  )

  /** 音频长度变化边界修正（T9）：超界片段删除、endSec 钳制；无改动不入历史 */
  const clampTimelineToDuration = useCallback(
    (durationSec: number) => {
      const cur = layoutRef.current
      const r = clampSegmentsToDuration({ segments: cur.timeline?.segments ?? [] }, durationSec)
      if (!r.changed) return
      pushHistory()
      applyLayout({ ...cur, timeline: { segments: r.segments } })
    },
    [applyLayout, pushHistory]
  )

  /** 全局基线关键帧整体替换（1.1.0 用户 #3：不分割时间轴也能打帧；t 为绝对秒） */
  const updateDocKeyframes = useCallback(
    (tracks: PropertyTrack[]) => {
      pushHistory()
      const cur = layoutRef.current
      applyLayout({
        ...cur,
        timeline: { ...(cur.timeline ?? { segments: [] }), keyframes: tracks }
      })
    },
    [applyLayout, pushHistory]
  )

  /** 裸创建关键帧（空帧槽：无属性、可点开后逐属性添加；segId=null → 全局基线） */
  const addEmptyFrame = useCallback(
    (segId: string | null, atSec: number) => {
      pushHistory()
      const cur = layoutRef.current
      if (segId) {
        const segments = (cur.timeline?.segments ?? []).map((s) =>
          s.id === segId
            ? {
                ...s,
                frameSlots: [...(s.frameSlots ?? []), atSec - s.startSec].sort((a, b) => a - b)
              }
            : s
        )
        applyLayout({ ...cur, timeline: { ...(cur.timeline ?? { segments: [] }), segments } })
      } else {
        const doc = cur.timeline ?? { segments: [] }
        applyLayout({
          ...cur,
          timeline: { ...doc, frameSlots: [...(doc.frameSlots ?? []), atSec].sort((a, b) => a - b) }
        })
      }
    },
    [applyLayout, pushHistory]
  )

  /** 空帧槽整体替换（segId=null → 全局；段内 t 相对段起点） */
  const updateFrameSlots = useCallback(
    (segId: string | null, slots: number[]) => {
      pushHistory()
      const cur = layoutRef.current
      if (segId) {
        const segments = (cur.timeline?.segments ?? []).map((s) =>
          s.id === segId ? { ...s, frameSlots: slots } : s
        )
        applyLayout({ ...cur, timeline: { ...(cur.timeline ?? { segments: [] }), segments } })
      } else {
        const doc = cur.timeline ?? { segments: [] }
        applyLayout({ ...cur, timeline: { ...doc, frameSlots: slots } })
      }
    },
    [applyLayout, pushHistory]
  )

  /** 段关键帧整体替换（1.0.0 T5：关键帧编辑器提交；t 相对片段起点） */
  const updateSegmentTracks = useCallback(
    (segId: string, tracks: PropertyTrack[]) => {
      pushHistory()
      const cur = layoutRef.current
      const segments = (cur.timeline?.segments ?? []).map((s) =>
        s.id === segId ? { ...s, keyframes: tracks } : s
      )
      applyLayout({ ...cur, timeline: { ...cur.timeline, segments } })
    },
    [applyLayout, pushHistory]
  )

  /** 将该段布局（视图）复制给全部其他段（批量覆盖；关键帧不动） */
  const applySegmentToAll = useCallback(
    (segId: string) => {
      pushHistory()
      const cur = layoutRef.current
      const src = (cur.timeline?.segments ?? []).find((s) => s.id === segId)
      if (!src) return
      const snapshot = src.layout ?? cur
      applyLayout({
        ...cur,
        timeline: {
          segments: (cur.timeline?.segments ?? []).map((s) =>
            s.id === segId ? s : { ...s, layout: structuredClone(snapshot) }
          )
        }
      })
    },
    [applyLayout, pushHistory]
  )

  const setAudioFile = useCallback((file: File | null) => {
    if (!file) return
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      setFileError(t('project.audioType', { ext }))
      return
    }
    setFileError(null)
    setAssets((prev) => {
      if (prev.audioUrl) URL.revokeObjectURL(prev.audioUrl)
      return { ...prev, audioUrl: URL.createObjectURL(file), audioFile: file }
    })
  }, [])

  /** 自定义字体（0.8.0）：ttf/otf；路径引用（注册由 useCustomFont 完成） */
  const setFontFile = useCallback((file: File | null) => {
    if (file) {
      setFileError(null)
      setAssets((prev) => ({ ...prev, fontFile: file }))
      return
    }
    setAssets((prev) => ({ ...prev, fontFile: null }))
  }, [])

  /** 图片 → dataURL（优先原文件字节，无文件则从已解码元素转画布） */
  const imageToDataUrl = useCallback(
    async (file: File | null, el: CanvasImageElement | null): Promise<string | null> => {
      if (file) {
        const buf = await file.arrayBuffer()
        const bytes = new Uint8Array(buf)
        let bin = ''
        for (let i = 0; i < bytes.length; i += 8192) {
          bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
        }
        return 'data:' + (file.type || 'image/png') + ';base64,' + btoa(bin)
      }
      if (el) {
        const c = document.createElement('canvas')
        c.width = (el as HTMLImageElement).naturalWidth || el.width
        c.height = (el as HTMLImageElement).naturalHeight || el.height
        const ctx = c.getContext('2d')
        if (ctx) {
          ctx.drawImage(el, 0, 0)
          return c.toDataURL('image/png')
        }
      }
      return null
    },
    []
  )

  const coverToDataUrl = useCallback(async (): Promise<string | null> => {
    const a = assetsRef.current
    return imageToDataUrl(a.coverFile, a.coverElement)
  }, [imageToDataUrl])

  const bgToDataUrl = useCallback(async (): Promise<string | null> => {
    const a = assetsRef.current
    return imageToDataUrl(a.bgFile, a.bgElement)
  }, [imageToDataUrl])

  /** 组装项目文件（封面/背景/附加层内嵌、音频只存路径） */
  const buildProjectFile = useCallback(async (): Promise<ProjectFile> => {
    const a = assetsRef.current
    const audioPath = a.audioFile ? window.api.getFilePath(a.audioFile) : ''
    // 附加层（0.8.0）：按布局层序导出（无图像的层跳过；字节随原文件或从已解码元素转画布）
    const overlays: { layerId: string; name: string; dataUrl: string }[] = []
    for (const o of layoutRef.current.overlayLayers ?? []) {
      const ov = a.overlayImages?.[o.id]
      if (!ov || (!ov.file && !ov.element)) continue
      const dataUrl = await imageToDataUrl(ov.file, ov.element)
      if (dataUrl) {
        overlays.push({ layerId: o.id, name: ov.file?.name ?? 'overlay.png', dataUrl })
      }
    }
    return {
      version: 1,
      app: 'NikoKaraokeVideoMaker',
      savedAt: new Date().toISOString(),
      layout: structuredClone(layoutRef.current),
      cover:
        a.coverUrl && a.coverFile
          ? { name: a.coverFile.name, dataUrl: (await coverToDataUrl()) ?? '' }
          : null,
      backgroundImage:
        a.bgUrl && a.bgFile ? { name: a.bgFile.name, dataUrl: (await bgToDataUrl()) ?? '' } : null,
      audio: a.audioFile ? { name: a.audioFile.name, path: audioPath } : null,
      font: a.fontFile ? { name: a.fontFile.name, path: window.api.getFilePath(a.fontFile) } : null,
      overlays
    }
  }, [coverToDataUrl, bgToDataUrl, imageToDataUrl])

  /** 应用项目文件：布局全量替换 + 封面内嵌恢复 + 音频按路径还原 */
  const applyProjectFile = useCallback(
    async (pf: ProjectFile): Promise<string[]> => {
      const warnings: string[] = []
      const base = structuredClone(DEFAULT_LAYOUT)
      const incoming = pf.layout
      const merged: ProjectLayout = {
        ...base,
        ...incoming,
        background: { ...base.background, ...incoming.background },
        mainImage: { ...base.mainImage, ...incoming.mainImage },
        texts: {
          songTitle: { ...base.texts.songTitle, ...incoming.texts.songTitle },
          artist: { ...base.texts.artist, ...incoming.texts.artist }
        },
        visualizer: { ...base.visualizer, ...incoming.visualizer },
        export: { ...base.export, ...incoming.export }
      }
      setLayout(merged)

      if (pf.cover && pf.cover.dataUrl) {
        loadCoverUrl(pf.cover.dataUrl, null)
      } else {
        setAssets((prev) => {
          if (prev.coverUrl) URL.revokeObjectURL(prev.coverUrl)
          return { ...prev, coverUrl: null, coverFile: null, coverElement: null }
        })
      }

      // 恢复独立背景图（或清空回退到封面图）
      if (pf.backgroundImage && pf.backgroundImage.dataUrl) {
        const url = pf.backgroundImage.dataUrl
        setAssets((prev) => {
          if (prev.bgUrl) URL.revokeObjectURL(prev.bgUrl)
          return { ...prev, bgUrl: url, bgFile: null, bgElement: null }
        })
        const img = new Image()
        img.onload = () => setAssets((prev) => ({ ...prev, bgElement: capImage(img) }))
        img.src = url
      } else {
        setAssets((prev) => {
          if (prev.bgUrl) URL.revokeObjectURL(prev.bgUrl)
          return { ...prev, bgUrl: null, bgFile: null, bgElement: null }
        })
      }

      if (pf.audio && pf.audio.path) {
        const res = await window.api.project.readFile(pf.audio.path)
        if (res.ok && res.buffer) {
          const ext = (pf.audio.name.split('.').pop() ?? 'bin').toLowerCase()
          const mime =
            ext === 'mp3'
              ? 'audio/mpeg'
              : ext === 'wav'
                ? 'audio/wav'
                : ext === 'flac'
                  ? 'audio/flac'
                  : ext === 'mp4'
                    ? 'video/mp4'
                    : 'application/octet-stream'
          const f = new File([res.buffer], pf.audio.name, { type: mime })
          setAssets((prev) => {
            if (prev.audioUrl) URL.revokeObjectURL(prev.audioUrl)
            return { ...prev, audioUrl: URL.createObjectURL(f), audioFile: f }
          })
        } else {
          warnings.push(t('project.audioMissing', { path: pf.audio.path }))
        }
      } else if (pf.audio) {
        warnings.push(t('project.audioNoPath'))
      }

      // 自定义字体（0.8.0）：路径引用——本机存在则重建 File（useCustomFont 自动注册），
      // 缺失则回退默认字体并提示
      if (pf.font?.path) {
        const fres = await window.api.project.readFile(pf.font.path)
        if (fres.ok && fres.buffer) {
          const f = new File([fres.buffer], pf.font.name, { type: 'font/ttf' })
          setAssets((prev) => ({ ...prev, fontFile: f }))
        } else {
          setAssets((prev) => ({ ...prev, fontFile: null }))
          warnings.push(t('project.fontMissing', { path: pf.font.path }))
        }
      } else if (pf.font) {
        setAssets((prev) => ({ ...prev, fontFile: null }))
        warnings.push(t('project.fontNoPath'))
      }

      // 附加层（0.8.0）：按 layerId 内嵌恢复（层配置已在上面随 layout 全量还原；
      // 无对应层（或不含图像）的条目跳过；dataURL 损坏 → 警告）
      for (const ov of pf.overlays ?? []) {
        if (!ov?.layerId || !ov.dataUrl) continue
        if (!(layoutRef.current.overlayLayers ?? []).some((o) => o.id === ov.layerId)) continue
        loadOverlayUrl(ov.layerId, ov.dataUrl, null)
      }

      setFileError(null)
      return warnings
    },
    [loadCoverUrl, loadOverlayUrl]
  )

  /** 保存项目（对话框 + 原子写 + 通知） */
  const saveProject = useCallback(async (): Promise<boolean> => {
    try {
      const pf = await buildProjectFile()
      const res = await window.api.project.save(
        JSON.stringify(pf, null, 2),
        layoutRef.current.texts.songTitle.text || t('project.defaultName')
      )
      if (res.canceled) return false
      if (res.ok) {
        setNotice(t('project.saved', { path: res.path ?? '' }))
        // 更新已保存快照（脏标记复位）
        const a = assetsRef.current
        setSavedSnapshot(snapshotOf(layoutRef.current, a))
        return true
      }
      setNotice(t('project.saveFailed'))
      return false
    } catch (e) {
      setFileError(t('project.saveError', { err: String(e) }))
      return false
    }
  }, [buildProjectFile])

  /** 打开项目（对话框 + 解析 + 应用 + 通知） */
  const loadProject = useCallback(async (): Promise<void> => {
    try {
      const res = await window.api.project.load()
      if (res.canceled) return
      if (!res.ok || !res.json) {
        setFileError(t('project.openFailed', { err: res.error ?? '未知错误' }))
        return
      }
      const pf = JSON.parse(res.json) as ProjectFile
      if (!pf || pf.version !== 1 || !pf.layout) {
        setFileError(t('project.badFormat'))
        return
      }
      const warnings = await applyProjectFile(pf)
      // 加载视为新的保存点：清空历史与脏标记
      pastRef.current = []
      futureRef.current = []
      bumpHistory()
      setSavedSnapshot(snapshotOf(layoutRef.current, assetsRef.current))
      if (warnings.length > 0) {
        setNotice(warnings.join('；'))
      } else {
        setNotice(t('project.opened'))
      }
    } catch (e) {
      setFileError(t('project.openFailed', { err: String(e) }))
    }
  }, [applyProjectFile, bumpHistory])

  /** 撤销：回退到上一个布局快照 */
  const undo = useCallback(() => {
    const past = pastRef.current
    if (past.length === 0) return
    const prev = past.pop() as string
    futureRef.current.push(JSON.stringify(layoutRef.current))
    try {
      applyLayout(JSON.parse(prev) as ProjectLayout)
    } catch {
      /* 快照损坏则忽略 */
    }
    bumpHistory()
  }, [applyLayout, bumpHistory])

  /** 重做 */
  const redo = useCallback(() => {
    const future = futureRef.current
    if (future.length === 0) return
    const next = future.pop() as string
    pastRef.current.push(JSON.stringify(layoutRef.current))
    try {
      applyLayout(JSON.parse(next) as ProjectLayout)
    } catch {
      /* 快照损坏则忽略 */
    }
    bumpHistory()
  }, [applyLayout, bumpHistory])

  const canUndo = histLen.past > 0
  const canRedo = histLen.future > 0

  /** 新建项目：恢复默认布局并清空素材（释放对象 URL） */
  const resetProject = useCallback(() => {
    const next = structuredClone(DEFAULT_LAYOUT)
    applyLayout(next)
    pastRef.current = []
    futureRef.current = []
    bumpHistory()
    setSavedSnapshot(snapshotOf(next, EMPTY_ASSETS))
    setAssets((prev) => {
      if (prev.coverUrl) URL.revokeObjectURL(prev.coverUrl)
      if (prev.audioUrl) URL.revokeObjectURL(prev.audioUrl)
      return EMPTY_ASSETS
    })
    setFileError(null)
    setNotice(null)
  }, [applyLayout, bumpHistory])

  /** 上传独立背景图（自动把背景来源切到 custom；布局变化进历史栈可撤销） */
  const setBgFile = useCallback(
    (file: File | null) => {
      if (!file) return
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!COVER_EXTENSIONS.includes(ext)) {
        setFileError(t('project.bgType', { ext }))
        return
      }
      setFileError(null)
      const url = URL.createObjectURL(file)
      setAssets((prev) => {
        if (prev.bgUrl) URL.revokeObjectURL(prev.bgUrl)
        return { ...prev, bgUrl: url, bgFile: file, bgElement: null }
      })
      const img = new Image()
      img.onload = () => setAssets((prev) => ({ ...prev, bgElement: capImage(img) }))
      img.onerror = () => setFileError(t('project.bgLoadFail'))
      img.src = url
      // 来源切换进历史栈（可 Ctrl+Z 撤销回默认封面图行为）
      commit((l) => ({ ...l, background: { ...l.background, imageSource: 'custom' } }))
    },
    [commit]
  )

  /** 清除独立背景图：回退到默认行为（用封面图） */
  const clearBgImage = useCallback(() => {
    setAssets((prev) => {
      if (prev.bgUrl) URL.revokeObjectURL(prev.bgUrl)
      return { ...prev, bgUrl: null, bgFile: null, bgElement: null }
    })
    commit((l) => ({ ...l, background: { ...l.background, imageSource: 'cover' } }))
  }, [commit])

  return {
    layout,
    /** 当前编辑视图（1.0.0 T4：段视图或全局基线） */
    view,
    /** 当前编辑目标（null=全局） */
    editSegId,
    /** 1-based 片段序号（0=全局） */
    editSegIndex,
    setEditSegment,
    setKfCurT,
    setKfAuto,
    assets,
    fileError,
    notice,
    updateBackground,
    updateMainRect,
    updateMainImage,
    updateText,
    updateTextGlobal,
    updateVisualizer,
    updateBackgroundFx,
    updateImageFx,
    updateTextEntry,
    updateCanvasFx,
    updateIntroOutro,
    updateBeatFx,
    updateAudioEngine,
    updateExport,
    setCoverFile,
    setCoverFromUrl,
    setAudioFile,
    setBgFile,
    clearBgImage,
    setOverlayFile,
    setOverlayFromUrl,
    setFontFile,
    addOverlayLayer,
    updateOverlayLayer,
    removeOverlayLayer,
    moveOverlayLayer,
    updateLayerState,
    moveLayerState,
    updateEditor,
    getSegmentLayoutView,
    updateSegmentLayout,
    addSegment,
    removeSegment,
    splitSegment,
    updateSegmentBounds,
    updateSegmentTransition,
    updateSegmentTracks,
    updateDocKeyframes,
    addEmptyFrame,
    updateFrameSlots,
    clampTimelineToDuration,
    applySegmentToAll,
    saveProject,
    loadProject,
    resetProject,
    undo,
    redo,
    canUndo,
    canRedo,
    dirty,
    clearNotice: () => setNotice(null),
    buildProjectFile,
    applyProjectFile
  }
}
