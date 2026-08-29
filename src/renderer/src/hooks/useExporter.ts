import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectLayout } from '@shared/layout'
import { RESOLUTIONS } from '@shared/layout'
import type { SpectrumAnalyzer } from '@shared/spectrum'
import type { ExportStageHandle } from '../components/ExportStageHost'
import { encodeVideo, type ExportProgressInfo } from '../export/exportVideo'
import { t } from '@shared/i18n'

export interface ExporterState extends ExportProgressInfo {
  error: string | null
  outputPath: string | null
  /** 编码阶段的最终统计消息（含 ms/帧） */
  encodeInfo: string | null
}

export interface UseExporterArgs {
  layout: ProjectLayout
  coverElement: import('./useProject').CanvasImageElement | null
  analyzer: SpectrumAnalyzer | null
  audioFile: File | null
  durationMs: number
  defaultName: string
  ffmpegAvailable: boolean
  /** 输出路径暂存（保存对话框结果 → 合并阶段使用） */
  outputPathRef: React.MutableRefObject<string>
}

/** Windows 路径比较：大小写不敏感、分隔符与结尾斜杠归一 */
export function sameFilePath(a: string, b: string): boolean {
  return (
    a.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() ===
    b.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  )
}

const IDLE: ExporterState = {
  phase: 'idle',
  encoded: 0,
  total: 0,
  mergePercent: null,
  message: '',
  error: null,
  outputPath: null,
  encodeInfo: null
}

/**
 * 导出编排（T18/T19）：保存对话框 → 编码（进度/取消）→ 写临时纯视频 → ffmpeg 合并（进度/取消）。
 */
export function useExporter(args: UseExporterArgs): {
  state: ExporterState
  stageRequest: { width: number; height: number } | null
  onStageReady: (h: ExportStageHandle) => void
  start: () => Promise<void>
  cancel: () => void
  reset: () => void
} {
  const [state, setState] = useState<ExporterState>(IDLE)
  const [stageRequest, setStageRequest] = useState<{ width: number; height: number } | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mergeIdRef = useRef<string | null>(null)
  const argsRef = useRef(args)

  useEffect(() => {
    argsRef.current = args
  })

  const update = useCallback((patch: Partial<ExporterState>) => {
    setState((s) => ({ ...s, ...patch }))
  }, [])

  const continuePipeline = useCallback(
    async (handle: ExportStageHandle) => {
      const a = argsRef.current
      const layout = a.layout
      const resolution =
        RESOLUTIONS.find((r) => r.id === layout.export.resolutionId) ?? RESOLUTIONS[1]
      const abort = abortRef.current
      if (!abort) return
      try {
        // 1) 编码纯视频（renderer）
        const buffer = await encodeVideo({
          layout,
          analyzer: a.analyzer,
          durationMs: a.durationMs,
          resolution,
          stage: handle,
          signal: abort.signal,
          onProgress: (p) =>
            update({
              ...p,
              error: null,
              encodeInfo:
                p.phase === 'encoding' && p.encoded === p.total && p.total > 0
                  ? p.message
                  : undefined
            })
        })
        if (!buffer) {
          update({ phase: 'cancelled', message: t('exporter.exportCancelled') })
          setStageRequest(null)
          return
        }
        if (abort.signal.aborted) {
          update({ phase: 'cancelled', message: t('exporter.exportCancelled') })
          setStageRequest(null)
          return
        }
        // 2) 纯视频写入临时文件（main）
        update({ phase: 'merging', mergePercent: 0, message: t('exporter.prepareMerge') })
        const videoPath = await window.api.exportApi.saveVideo(
          buffer,
          'video-' + Date.now() + '.mp4'
        )
        // 3) 音频路径：优先原文件路径（拖放/选择），缺失则把字节写临时文件（无路径来源如内存生成）
        let audioPath = a.audioFile ? window.api.getFilePath(a.audioFile) : ''
        if (!audioPath && a.audioFile) {
          const ab = await a.audioFile.arrayBuffer()
          audioPath = await window.api.exportApi.saveAudio(
            ab,
            'audio-' + Date.now() + '.' + (a.audioFile.name.split('.').pop() ?? 'bin')
          )
        }
        if (!audioPath) throw new Error(t('exporter.noAudioPath'))
        // 4) ffmpeg 合并
        const mergeId = crypto.randomUUID()
        mergeIdRef.current = mergeId
        update({ phase: 'merging', mergePercent: 0, message: t('exporter.merging') })
        const off = window.api.exportApi.onMergeProgress((p) => {
          update({ phase: 'merging', mergePercent: p.percent, message: p.message })
        })
        const res = await window.api.exportApi.merge({
          mergeId,
          videoPath,
          audioPath,
          outputPath: a.outputPathRef.current ?? '',
          durationMs: a.durationMs,
          audioEngine: {
            leadMs: layout.audio.leadMs,
            fadeInSec: layout.audio.fadeInSec,
            fadeOutSec: layout.audio.fadeOutSec
          }
        })
        off()
        mergeIdRef.current = null
        if (!res.ok) throw new Error(res.error ?? t('exporter.mergeFailed'))
        update({
          phase: 'done',
          encoded: a.durationMs ? Math.round((a.durationMs / 1000) * layout.export.fps) : 0,
          total: a.durationMs ? Math.round((a.durationMs / 1000) * layout.export.fps) : 0,
          mergePercent: 100,
          message: t('exporter.exportDone', { path: a.outputPathRef.current ?? '' })
        })
      } catch (e) {
        if (abort.signal.aborted) {
          update({ phase: 'cancelled', message: t('exporter.exportCancelled') })
        } else {
          const msg = e instanceof Error ? e.message : String(e)
          update({ phase: 'error', error: msg, message: t('exporter.exportFailed') })
        }
      } finally {
        setStageRequest(null)
      }
    },
    [update]
  )

  const onStageReady = useCallback(
    (h: ExportStageHandle) => {
      void continuePipeline(h)
    },
    [continuePipeline]
  )

  const start = useCallback(async () => {
    const a = argsRef.current
    if (!a.ffmpegAvailable) {
      setState({ ...IDLE, phase: 'error', error: t('exporter.noFfmpeg') })
      return
    }
    if (!a.audioFile || !a.analyzer) {
      setState({ ...IDLE, phase: 'error', error: t('exporter.needAudio') })
      return
    }
    const resolution =
      RESOLUTIONS.find((r) => r.id === a.layout.export.resolutionId) ?? RESOLUTIONS[1]
    const outputPath = await window.api.exportApi.pickOutput(
      a.defaultName || t('exporter.unnamedSong')
    )
    if (!outputPath) return
    // 输出路径与音频源文件相同 → ffmpeg 无法原地覆盖输入（合并必然失败），提前拦截给出可读提示
    if (a.audioFile) {
      const audioPath = window.api.getFilePath(a.audioFile)
      if (audioPath && sameFilePath(outputPath, audioPath)) {
        setState({
          ...IDLE,
          phase: 'error',
          error: t('exporter.sameFile')
        })
        return
      }
    }
    const abort = new AbortController()
    abortRef.current = abort
    a.outputPathRef.current = outputPath
    setState({ ...IDLE, phase: 'preparing', message: t('exporter.preparing'), outputPath })
    setStageRequest({ width: resolution.width, height: resolution.height })
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    if (mergeIdRef.current) {
      void window.api.exportApi.cancelMerge(mergeIdRef.current)
    }
    update({ phase: 'cancelled', message: t('exporter.exportCancelled') })
  }, [update])

  const reset = useCallback(() => {
    setState(IDLE)
  }, [])

  return { state, stageRequest, onStageReady, start, cancel, reset }
}
