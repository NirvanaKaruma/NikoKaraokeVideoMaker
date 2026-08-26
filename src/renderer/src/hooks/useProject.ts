import { useCallback, useState } from 'react'
import {
  BackgroundConfig,
  DEFAULT_LAYOUT,
  ExportConfig,
  MainImageConfig,
  NormRect,
  ProjectLayout,
  TextLayerConfig,
  VisualizerConfig
} from '@shared/layout'

export const COVER_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']
/** 音频 + 可提取音轨的视频（预览解码由 Chromium 支持，导出由 ffmpeg 提取音轨） */
export const AUDIO_EXTENSIONS = ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'mp4', 'm4v', 'mov', 'webm']

export interface ProjectAssets {
  coverUrl: string | null
  coverFile: File | null
  /** 已解码的封面 Image 元素（Konva 绘制用） */
  coverElement: HTMLImageElement | null
  audioUrl: string | null
  audioFile: File | null
}

const EMPTY_ASSETS: ProjectAssets = {
  coverUrl: null,
  coverFile: null,
  coverElement: null,
  audioUrl: null,
  audioFile: null
}

/**
 * 项目状态：归一化布局（唯一数据源）+ 输入资产。
 * 预览与导出都从这份状态读取，保证所见即所得（核心约束 A）。
 */
export function useProject(): {
  layout: ProjectLayout
  assets: ProjectAssets
  fileError: string | null
  updateBackground: (patch: Partial<BackgroundConfig>) => void
  updateMainRect: (rect: NormRect) => void
  updateMainImage: (patch: Partial<MainImageConfig>) => void
  updateText: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => void
  updateVisualizer: (patch: Partial<VisualizerConfig>) => void
  updateExport: (patch: Partial<ExportConfig>) => void
  setCoverFile: (file: File | null) => void
  setCoverFromUrl: (url: string) => void
  setAudioFile: (file: File | null) => void
} {
  const [layout, setLayout] = useState<ProjectLayout>(() => structuredClone(DEFAULT_LAYOUT))
  const [assets, setAssets] = useState<ProjectAssets>(EMPTY_ASSETS)
  const [fileError, setFileError] = useState<string | null>(null)

  const updateBackground = useCallback((patch: Partial<BackgroundConfig>) => {
    setLayout((l) => ({ ...l, background: { ...l.background, ...patch } }))
  }, [])

  const updateMainRect = useCallback((rect: NormRect) => {
    setLayout((l) => ({ ...l, mainImage: { ...l.mainImage, rect } }))
  }, [])

  const updateMainImage = useCallback((patch: Partial<MainImageConfig>) => {
    setLayout((l) => ({ ...l, mainImage: { ...l.mainImage, ...patch } }))
  }, [])

  const updateText = useCallback(
    (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => {
      setLayout((l) => ({
        ...l,
        texts: { ...l.texts, [kind]: { ...l.texts[kind], ...patch } }
      }))
    },
    []
  )

  const updateVisualizer = useCallback((patch: Partial<VisualizerConfig>) => {
    setLayout((l) => ({ ...l, visualizer: { ...l.visualizer, ...patch } }))
  }, [])

  const updateExport = useCallback((patch: Partial<ExportConfig>) => {
    setLayout((l) => ({ ...l, export: { ...l.export, ...patch } }))
  }, [])

  const loadCoverUrl = useCallback((url: string, file: File | null) => {
    setAssets((prev) => {
      if (prev.coverUrl) URL.revokeObjectURL(prev.coverUrl)
      return { ...prev, coverUrl: url, coverFile: file, coverElement: null }
    })
    const img = new Image()
    img.onload = () => setAssets((prev) => ({ ...prev, coverElement: img }))
    img.onerror = () => setFileError('封面图片加载失败，请换一张试试')
    img.src = url
  }, [])

  const setCoverFile = useCallback(
    (file: File | null) => {
      if (!file) return
      const ext = (file.name.split('.').pop() ?? '').toLowerCase()
      if (!COVER_EXTENSIONS.includes(ext)) {
        setFileError(`封面仅支持 png/jpg/webp（收到 .${ext}）`)
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

  const setAudioFile = useCallback((file: File | null) => {
    if (!file) return
    const ext = (file.name.split('.').pop() ?? '').toLowerCase()
    if (!AUDIO_EXTENSIONS.includes(ext)) {
      setFileError(`仅支持 mp3/wav/flac/m4a/ogg/mp4/m4v/mov/webm（收到 .${ext}）`)
      return
    }
    setFileError(null)
    setAssets((prev) => {
      if (prev.audioUrl) URL.revokeObjectURL(prev.audioUrl)
      return { ...prev, audioUrl: URL.createObjectURL(file), audioFile: file }
    })
  }, [])

  return {
    layout,
    assets,
    fileError,
    updateBackground,
    updateMainRect,
    updateMainImage,
    updateText,
    updateVisualizer,
    updateExport,
    setCoverFile,
    setCoverFromUrl,
    setAudioFile
  }
}
