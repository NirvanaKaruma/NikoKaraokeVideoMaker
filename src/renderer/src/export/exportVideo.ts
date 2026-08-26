import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import type { ProjectLayout, ResolutionOption } from '@shared/layout'
import { smoothBars, spectrumAt, type SpectrumAnalyzer } from '@shared/spectrum'
import type { ExportStageHandle } from '../components/ExportStageHost'

export type ExportPhase =
  'idle' | 'preparing' | 'encoding' | 'merging' | 'done' | 'error' | 'cancelled'

export interface ExportProgressInfo {
  phase: ExportPhase
  encoded: number
  total: number
  mergePercent: number | null
  message: string
}

const BITRATE_TABLE: Record<string, number> = {
  '720p': 6_000_000,
  '1080p': 10_000_000,
  '2k': 16_000_000,
  '4k': 28_000_000
}

const H264_CODECS = ['avc1.640033', 'avc1.640028', 'avc1.4d0028', 'avc1.42e01f', 'avc1.42001f']

/** 让出事件循环：用 MessageChannel（宏任务），隐藏窗口不会被 Chromium 节流（setTimeout 会被节流到分钟级） */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const mc = new MessageChannel()
    mc.port1.onmessage = () => resolve()
    mc.port2.postMessage(0)
  })
}

export interface EncodeVideoOptions {
  layout: ProjectLayout
  analyzer: SpectrumAnalyzer | null
  durationMs: number
  resolution: ResolutionOption
  stage: ExportStageHandle
  onProgress: (p: ExportProgressInfo) => void
  signal: AbortSignal
}

/**
 * 导出编码（T18）：静态层一次渲染 + 逐帧频谱 → H.264(yuv420p) → mp4-muxer 纯视频。
 * 取消：signal.aborted → 返回 null（由调用方清理）。
 */
export async function encodeVideo(opts: EncodeVideoOptions): Promise<ArrayBuffer | null> {
  const { layout, analyzer, durationMs, resolution, stage, onProgress, signal } = opts
  const fps = layout.export.fps
  const totalFrames = Math.max(1, Math.round((durationMs / 1000) * fps))

  let encoderConfig: VideoEncoderConfig | null = null
  for (const codec of H264_CODECS) {
    const cfg: VideoEncoderConfig = {
      codec,
      width: resolution.width,
      height: resolution.height,
      bitrate: BITRATE_TABLE[resolution.id] ?? 10_000_000,
      framerate: fps
    }
    try {
      const support = await VideoEncoder.isConfigSupported(cfg)
      if (support.supported) {
        encoderConfig = cfg
        break
      }
    } catch {
      /* 尝试下一个 codec */
    }
  }
  if (!encoderConfig) {
    throw new Error(
      '当前环境不支持 H.264 编码（WebCodecs 不可用）。建议降低分辨率重试，或更换支持硬件加速的电脑。'
    )
  }

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width: resolution.width, height: resolution.height },
    fastStart: 'in-memory'
  })

  let encoderError: Error | null = null
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e))
    }
  })
  encoder.configure(encoderConfig)

  const compose = document.createElement('canvas')
  compose.width = resolution.width
  compose.height = resolution.height
  const ctx = compose.getContext('2d')
  if (!ctx) {
    encoder.close()
    throw new Error('无法创建导出画布')
  }

  const staticCanvas = stage.renderStatic()
  let prevBars: Float32Array | null = null
  const vizCfg = layout.visualizer
  const frameMs: number[] = []
  const totalT0 = performance.now()

  onProgress({
    phase: 'encoding',
    encoded: 0,
    total: totalFrames,
    mergePercent: null,
    message: '正在编码视频帧…'
  })

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) {
        return null
      }
      const f0 = performance.now()
      const t = i / fps
      if (analyzer) {
        const target = spectrumAt(analyzer, t, vizCfg.barCount, null, vizCfg.sensitivity)
        prevBars = smoothBars(prevBars, target, vizCfg.smoothing)
        stage.setBars(Array.from(prevBars))
      }
      const viz = stage.renderViz()
      ctx.drawImage(staticCanvas, 0, 0)
      ctx.drawImage(viz, 0, 0)
      const frame = new VideoFrame(compose, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps)
      })
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()
      if (encoderError) throw encoderError
      frameMs.push(performance.now() - f0)
      let message = '正在编码视频帧…'
      if ((i + 1) % 30 === 0) {
        const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length
        message =
          '正在编码视频帧… 帧 ' +
          (i + 1) +
          '/' +
          totalFrames +
          '（平均 ' +
          Math.round(avg) +
          'ms/帧）'
      }
      onProgress({
        phase: 'encoding',
        encoded: i + 1,
        total: totalFrames,
        mergePercent: null,
        message
      })
      // 每 2 帧让出事件循环（进度 UI / 取消响应）；MessageChannel 不受后台节流影响
      if (i % 2 === 1) await yieldToEventLoop()
    }
    const totalMs = performance.now() - totalT0
    onProgress({
      phase: 'encoding',
      encoded: totalFrames,
      total: totalFrames,
      mergePercent: null,
      message:
        '编码完成：' +
        totalFrames +
        ' 帧 / ' +
        Math.round(totalMs / 1000) +
        's（平均 ' +
        Math.round(totalMs / totalFrames) +
        'ms/帧）'
    })
    await encoder.flush()
    if (encoderError) throw encoderError
    muxer.finalize()
    return muxer.target.buffer
  } finally {
    try {
      encoder.close()
    } catch {
      /* 已关闭 */
    }
  }
}
