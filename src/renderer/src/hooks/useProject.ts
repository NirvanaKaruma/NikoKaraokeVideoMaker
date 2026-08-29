import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AudioEngineConfig,
  BackgroundConfig,
  BeatFxConfig,
  CanvasFxConfig,
  DEFAULT_LAYOUT,
  ExportConfig,
  IntroOutroConfig,
  MainImageConfig,
  NormRect,
  OverlayLayerConfig,
  ProjectLayout,
  TextLayerConfig,
  VisualizerConfig
} from '@shared/layout'
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
  assets: ProjectAssets
  fileError: string | null
  notice: string | null
  updateBackground: (patch: Partial<BackgroundConfig>) => void
  updateMainRect: (rect: NormRect) => void
  updateMainImage: (patch: Partial<MainImageConfig>) => void
  updateText: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => void
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
  /** 一键主题色（0.8.0）：背景基色 + 可视化渐变（一次撤销；文字颜色不动） */
  applyTheme: (theme: { bg: string; vizColors: string[] }) => void
  /** 附加层：新增（默认右下角/水印位），返回新层 id */
  addOverlayLayer: () => string
  /** 附加层：改配置（rect/opacity/fx/entry） */
  updateOverlayLayer: (id: string, patch: Partial<OverlayLayerConfig>) => void
  /** 附加层：删除（连同其图像资产） */
  removeOverlayLayer: (id: string) => void
  /** 附加层：z 序上移/下移（-1=上，1=下） */
  moveOverlayLayer: (id: string, dir: -1 | 1) => void
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

  const updateBackground = useCallback(
    (patch: Partial<BackgroundConfig>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        background: { ...layoutRef.current.background, ...patch }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateMainRect = useCallback(
    (rect: NormRect) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, mainImage: { ...layoutRef.current.mainImage, rect } })
    },
    [pushHistory, applyLayout]
  )

  const updateMainImage = useCallback(
    (patch: Partial<MainImageConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, mainImage: { ...layoutRef.current.mainImage, ...patch } })
    },
    [pushHistory, applyLayout]
  )

  const updateText = useCallback(
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
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        visualizer: { ...layoutRef.current.visualizer, ...patch }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateBackgroundFx = useCallback(
    (patch: Partial<BackgroundConfig['fx']>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        background: {
          ...layoutRef.current.background,
          fx: { ...layoutRef.current.background.fx, ...patch }
        }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateImageFx = useCallback(
    (patch: Partial<MainImageConfig['fx']>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        mainImage: {
          ...layoutRef.current.mainImage,
          fx: { ...layoutRef.current.mainImage.fx, ...patch }
        }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateTextEntry = useCallback(
    (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig['entry']>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        texts: {
          ...layoutRef.current.texts,
          [kind]: {
            ...layoutRef.current.texts[kind],
            entry: { ...layoutRef.current.texts[kind].entry, ...patch }
          }
        }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateCanvasFx = useCallback(
    (patch: Partial<CanvasFxConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, canvasFx: { ...layoutRef.current.canvasFx, ...patch } })
    },
    [pushHistory, applyLayout]
  )

  const updateIntroOutro = useCallback(
    (patch: Partial<IntroOutroConfig>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        introOutro: { ...layoutRef.current.introOutro, ...patch }
      })
    },
    [pushHistory, applyLayout]
  )

  const updateBeatFx = useCallback(
    (patch: Partial<BeatFxConfig>) => {
      pushHistory()
      applyLayout({ ...layoutRef.current, beat: { ...layoutRef.current.beat, ...patch } })
    },
    [pushHistory, applyLayout]
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

  const addOverlayLayer = useCallback((): string => {
    const layer = overlayDefaults()
    pushHistory()
    applyLayout({
      ...layoutRef.current,
      overlayLayers: [...layoutRef.current.overlayLayers, layer]
    })
    return layer.id
  }, [applyLayout, overlayDefaults, pushHistory])

  const updateOverlayLayer = useCallback(
    (id: string, patch: Partial<OverlayLayerConfig>) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        overlayLayers: layoutRef.current.overlayLayers.map((o) =>
          o.id === id ? { ...o, ...patch, id: o.id } : o
        )
      })
    },
    [applyLayout, pushHistory]
  )

  const removeOverlayLayer = useCallback(
    (id: string) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        overlayLayers: layoutRef.current.overlayLayers.filter((o) => o.id !== id)
      })
      setAssets((prev) => {
        const old = prev.overlayImages?.[id]
        if (old?.url) URL.revokeObjectURL(old.url)
        const next = { ...(prev.overlayImages ?? {}) }
        delete next[id]
        return { ...prev, overlayImages: next }
      })
    },
    [applyLayout, pushHistory]
  )

  const moveOverlayLayer = useCallback(
    (id: string, dir: -1 | 1) => {
      pushHistory()
      const arr = [...layoutRef.current.overlayLayers]
      const i = arr.findIndex((o) => o.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= arr.length) return
      const tmp = arr[i]
      arr[i] = arr[j]
      arr[j] = tmp
      applyLayout({ ...layoutRef.current, overlayLayers: arr })
    },
    [applyLayout, pushHistory]
  )

  const applyTheme = useCallback(
    (theme: { bg: string; vizColors: string[] }) => {
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        background: { ...layoutRef.current.background, color: theme.bg },
        visualizer: { ...layoutRef.current.visualizer, colors: theme.vizColors }
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
      pushHistory()
      applyLayout({
        ...layoutRef.current,
        background: { ...layoutRef.current.background, imageSource: 'custom' }
      })
    },
    [pushHistory, applyLayout]
  )

  /** 清除独立背景图：回退到默认行为（用封面图） */
  const clearBgImage = useCallback(() => {
    setAssets((prev) => {
      if (prev.bgUrl) URL.revokeObjectURL(prev.bgUrl)
      return { ...prev, bgUrl: null, bgFile: null, bgElement: null }
    })
    pushHistory()
    applyLayout({
      ...layoutRef.current,
      background: { ...layoutRef.current.background, imageSource: 'cover' }
    })
  }, [pushHistory, applyLayout])

  return {
    layout,
    assets,
    fileError,
    notice,
    updateBackground,
    updateMainRect,
    updateMainImage,
    updateText,
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
    applyTheme,
    addOverlayLayer,
    updateOverlayLayer,
    removeOverlayLayer,
    moveOverlayLayer,
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
