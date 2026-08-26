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

/** 编码模式偏好持久化键（GPU 检测结果自动写入） */
const MODE_PREF_KEY = 'niko.encode.modePref'

/** 探测顺序：默认 GPU 优先；若基准检测到本机软件更快，则自动改为软件优先 */
function getModeOrder(): HardwareAcceleration[] {
  try {
    if (localStorage.getItem(MODE_PREF_KEY) === 'sw') {
      return ['prefer-software', 'no-preference', 'prefer-hardware']
    }
  } catch {
    /* localStorage 不可用时忽略 */
  }
  return ['prefer-hardware', 'no-preference', 'prefer-software']
}

export interface EncoderChoice {
  codec: string
  mode: HardwareAcceleration
}

/** 探测可用的 H.264 配置：优先 GPU 硬件编码 */
async function pickEncoderConfig(
  width: number,
  height: number,
  fps: number,
  bitrate: number
): Promise<{ config: VideoEncoderConfig; choice: EncoderChoice } | null> {
  for (const mode of getModeOrder()) {
    for (const codec of H264_CODECS) {
      const cfg: VideoEncoderConfig = {
        codec,
        width,
        height,
        bitrate,
        framerate: fps,
        hardwareAcceleration: mode
      }
      try {
        const support = await VideoEncoder.isConfigSupported(cfg)
        if (support.supported) {
          return { config: cfg, choice: { codec, mode } }
        }
      } catch {
        /* 尝试下一个 */
      }
    }
  }
  return null
}

/** 让出事件循环：用 MessageChannel（宏任务），隐藏窗口不会被 Chromium 节流（setTimeout 会被节流到分钟级） */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    const mc = new MessageChannel()
    mc.port1.onmessage = () => resolve()
    mc.port2.postMessage(0)
  })
}

/** 按指定硬件模式编码 30 帧纯色画面，返回 ms/帧（不可用返回 null） */
async function encodeFramesTimed(
  width: number,
  height: number,
  mode: HardwareAcceleration,
  frames = 30
): Promise<number | null> {
  const picked = await pickEncoderConfig(width, height, 30, 10_000_000)
  if (!picked) return null
  // 用指定 mode 覆盖
  const cfg: VideoEncoderConfig = { ...picked.config, hardwareAcceleration: mode }
  try {
    const support = await VideoEncoder.isConfigSupported(cfg)
    if (!support.supported) return null
  } catch {
    return null
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  ctx.fillStyle = '#336699'
  ctx.fillRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(width / 4, height / 4, width / 2, height / 2)
  const encoder = new VideoEncoder({
    output: () => undefined,
    error: () => undefined
  })
  encoder.configure(cfg)
  const t0 = performance.now()
  for (let i = 0; i < frames; i++) {
    const f = new VideoFrame(canvas, { timestamp: i * 33333, duration: 33333 })
    encoder.encode(f, { keyFrame: i === 0 })
    f.close()
  }
  await encoder.flush()
  encoder.close()
  return (performance.now() - t0) / frames
}

export interface EncodeBenchmark {
  width: number
  height: number
  hardwareMsPerFrame: number | null
  softwareMsPerFrame: number | null
  verdict: string
}

/**
 * GPU 加速检测（用户需求）：同一测试画面分别以 prefer-hardware 与 prefer-software
 * 各编码 30 帧，用实测速度给出结论。导出管线本身始终走「硬件优先」探测。
 */
export async function benchmarkEncoder(width: number, height: number): Promise<EncodeBenchmark> {
  const hardware = await encodeFramesTimed(width, height, 'prefer-hardware')
  const software = await encodeFramesTimed(width, height, 'prefer-software')
  let verdict: string
  if (hardware == null) {
    verdict = '硬件编码不可用：导出将使用软件编码（速度取决于 CPU）'
    try {
      localStorage.setItem(MODE_PREF_KEY, 'sw')
    } catch {
      /* 忽略 */
    }
  } else if (software == null) {
    verdict = '软件编码不可用，硬件编码正常：导出将使用 GPU 加速'
    try {
      localStorage.setItem(MODE_PREF_KEY, 'hw')
    } catch {
      /* 忽略 */
    }
  } else if (hardware <= software * 0.7) {
    verdict = 'GPU 加速可用：硬件编码明显快于软件，导出已自动选用 GPU 编码'
    try {
      localStorage.setItem(MODE_PREF_KEY, 'hw')
    } catch {
      /* 忽略 */
    }
  } else {
    verdict =
      '本机 GPU 编码未带来加速（软件反而更快）→ 导出已自动选用软件编码；' +
      '若更换显卡/驱动后可重新检测'
    try {
      localStorage.setItem(MODE_PREF_KEY, 'sw')
    } catch {
      /* 忽略 */
    }
  }
  return { width, height, hardwareMsPerFrame: hardware, softwareMsPerFrame: software, verdict }
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

  const picked = await pickEncoderConfig(
    resolution.width,
    resolution.height,
    fps,
    BITRATE_TABLE[resolution.id] ?? 10_000_000
  )
  if (!picked) {
    throw new Error(
      '当前环境不支持 H.264 编码（WebCodecs 不可用）。建议降低分辨率重试，或更换支持硬件加速的电脑。'
    )
  }
  const encoderConfig = picked.config
  const modeLabel =
    picked.choice.mode === 'prefer-hardware'
      ? '硬件优先'
      : picked.choice.mode === 'prefer-software'
        ? '软件'
        : '自动'

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
        'ms/帧）· 编码器 ' +
        picked.choice.codec +
        '（' +
        modeLabel +
        '）'
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
