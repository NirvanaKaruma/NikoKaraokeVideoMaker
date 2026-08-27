import { useCallback, useEffect, useRef, useState } from 'react'
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
import type { ProjectFile } from '@shared/project'

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
  notice: string | null
  updateBackground: (patch: Partial<BackgroundConfig>) => void
  updateMainRect: (rect: NormRect) => void
  updateMainImage: (patch: Partial<MainImageConfig>) => void
  updateText: (kind: 'songTitle' | 'artist', patch: Partial<TextLayerConfig>) => void
  updateVisualizer: (patch: Partial<VisualizerConfig>) => void
  updateExport: (patch: Partial<ExportConfig>) => void
  setCoverFile: (file: File | null) => void
  setCoverFromUrl: (url: string) => void
  setAudioFile: (file: File | null) => void
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
  const [savedSnapshot, setSavedSnapshot] = useState<string>(() =>
    JSON.stringify({ layout, hasCover: false, hasAudio: false })
  )

  useEffect(() => {
    layoutRef.current = layout
    assetsRef.current = assets
  }, [layout, assets])

  /** 脏标记：渲染期派生（快照字符串对比，不产生级联渲染） */
  const dirty =
    JSON.stringify({
      layout,
      hasCover: assets.coverUrl != null,
      hasAudio: assets.audioUrl != null
    }) !== savedSnapshot

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

  /** 封面 → dataURL（优先原文件字节，无文件则从已解码元素转画布） */
  const coverToDataUrl = useCallback(async (): Promise<string | null> => {
    const file = assetsRef.current.coverFile
    if (file) {
      const buf = await file.arrayBuffer()
      const bytes = new Uint8Array(buf)
      let bin = ''
      for (let i = 0; i < bytes.length; i += 8192) {
        bin += String.fromCharCode(...bytes.subarray(i, i + 8192))
      }
      return 'data:' + (file.type || 'image/png') + ';base64,' + btoa(bin)
    }
    const img = assetsRef.current.coverElement
    if (img) {
      const c = document.createElement('canvas')
      c.width = img.naturalWidth || img.width
      c.height = img.naturalHeight || img.height
      const ctx = c.getContext('2d')
      if (ctx) {
        ctx.drawImage(img, 0, 0)
        return c.toDataURL('image/png')
      }
    }
    return null
  }, [])

  /** 组装项目文件（封面内嵌、音频只存路径） */
  const buildProjectFile = useCallback(async (): Promise<ProjectFile> => {
    const a = assetsRef.current
    const audioPath = a.audioFile ? window.api.getFilePath(a.audioFile) : ''
    return {
      version: 1,
      app: 'NikoKaraokeVideoMaker',
      savedAt: new Date().toISOString(),
      layout: structuredClone(layoutRef.current),
      cover:
        a.coverUrl && a.coverFile
          ? { name: a.coverFile.name, dataUrl: (await coverToDataUrl()) ?? '' }
          : null,
      audio: a.audioFile ? { name: a.audioFile.name, path: audioPath } : null
    }
  }, [coverToDataUrl])

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
          warnings.push('音频文件未找到（' + pf.audio.path + '），请重新拖入音频')
        }
      } else if (pf.audio) {
        warnings.push('项目保存时音频无磁盘路径，请重新拖入音频')
      }

      setFileError(null)
      return warnings
    },
    [loadCoverUrl]
  )

  /** 保存项目（对话框 + 原子写 + 通知） */
  const saveProject = useCallback(async (): Promise<boolean> => {
    try {
      const pf = await buildProjectFile()
      const res = await window.api.project.save(
        JSON.stringify(pf, null, 2),
        layoutRef.current.texts.songTitle.text || '未命名项目'
      )
      if (res.canceled) return false
      if (res.ok) {
        setNotice('项目已保存：' + res.path)
        // 更新已保存快照（脏标记复位）
        const a = assetsRef.current
        setSavedSnapshot(
          JSON.stringify({
            layout: layoutRef.current,
            hasCover: a.coverUrl != null,
            hasAudio: a.audioUrl != null
          })
        )
        return true
      }
      setNotice('保存失败')
      return false
    } catch (e) {
      setFileError('保存项目失败：' + String(e))
      return false
    }
  }, [buildProjectFile])

  /** 打开项目（对话框 + 解析 + 应用 + 通知） */
  const loadProject = useCallback(async (): Promise<void> => {
    try {
      const res = await window.api.project.load()
      if (res.canceled) return
      if (!res.ok || !res.json) {
        setFileError('打开项目失败：' + (res.error ?? '未知错误'))
        return
      }
      const pf = JSON.parse(res.json) as ProjectFile
      if (!pf || pf.version !== 1 || !pf.layout) {
        setFileError('项目文件格式不支持或已损坏')
        return
      }
      const warnings = await applyProjectFile(pf)
      // 加载视为新的保存点：清空历史与脏标记
      pastRef.current = []
      futureRef.current = []
      bumpHistory()
      setSavedSnapshot(
        JSON.stringify({
          layout: layoutRef.current,
          hasCover: assetsRef.current.coverUrl != null,
          hasAudio: assetsRef.current.audioUrl != null
        })
      )
      if (warnings.length > 0) {
        setNotice(warnings.join('；'))
      } else {
        setNotice('项目已打开')
      }
    } catch (e) {
      setFileError('打开项目失败：' + String(e))
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
    setSavedSnapshot(JSON.stringify({ layout: next, hasCover: false, hasAudio: false }))
    setAssets((prev) => {
      if (prev.coverUrl) URL.revokeObjectURL(prev.coverUrl)
      if (prev.audioUrl) URL.revokeObjectURL(prev.audioUrl)
      return EMPTY_ASSETS
    })
    setFileError(null)
    setNotice(null)
  }, [applyLayout, bumpHistory])

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
    updateExport,
    setCoverFile,
    setCoverFromUrl,
    setAudioFile,
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
