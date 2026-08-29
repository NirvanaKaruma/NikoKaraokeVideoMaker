import { ArrayBufferTarget, Muxer } from 'mp4-muxer'
import {
  hasCustomLayerOrder,
  hasDynamicFx,
  type ProjectLayout,
  type ResolutionOption
} from '@shared/layout'
import { hasTimeline, resolveLayoutAt } from '@shared/timeline'
import { bandEnergiesAt, spectrumAt, type SpectrumAnalyzer } from '@shared/spectrum'
import { beatEnvelope, beatPeriod, smoothBarsFx, type SmoothFxState } from '@shared/fx'
import { drawCanvasFx } from '@shared/canvasfx'
import { drawParticles, particlesAt } from '@shared/particles'
import type { ExportStageHandle } from '../components/ExportStageHost'
import { t } from '@shared/i18n'

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

/** 用户显式编码模式：auto（按检测）/ hw（强制硬件）/ sw（强制软件） */
export type EncodeModePref = 'auto' | 'hw' | 'sw'

const MODE_PREF_KEY = 'niko.encode.modePref'
const AUTO_CHOICE_KEY = 'niko.encode.autoChoice'

export function getEncodeModePref(): EncodeModePref {
  try {
    const v = localStorage.getItem(MODE_PREF_KEY)
    if (v === 'hw' || v === 'sw') return v
  } catch {
    /* 忽略 */
  }
  return 'auto'
}

export function setEncodeModePref(pref: EncodeModePref): void {
  try {
    localStorage.setItem(MODE_PREF_KEY, pref)
  } catch {
    /* 忽略 */
  }
}

/** 探测顺序：auto → 按基准结论（默认硬件优先）；hw/sw → 强制对应模式优先 */
function getModeOrder(): HardwareAcceleration[] {
  const pref = getEncodeModePref()
  if (pref === 'hw') return ['prefer-hardware', 'no-preference', 'prefer-software']
  if (pref === 'sw') return ['prefer-software', 'no-preference', 'prefer-hardware']
  try {
    if (localStorage.getItem(AUTO_CHOICE_KEY) === 'sw') {
      return ['prefer-software', 'no-preference', 'prefer-hardware']
    }
  } catch {
    /* 忽略 */
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
    verdict = t('exporter.verdictHwUnavailable')
    try {
      localStorage.setItem(AUTO_CHOICE_KEY, 'sw')
    } catch {
      /* 忽略 */
    }
  } else if (software == null) {
    verdict = t('exporter.verdictSwUnavailable')
    try {
      localStorage.setItem(AUTO_CHOICE_KEY, 'hw')
    } catch {
      /* 忽略 */
    }
  } else if (hardware <= software * 0.7) {
    verdict = t('exporter.verdictHwFaster')
    try {
      localStorage.setItem(AUTO_CHOICE_KEY, 'hw')
    } catch {
      /* 忽略 */
    }
  } else {
    verdict = t('exporter.verdictSwFaster')
    try {
      localStorage.setItem(AUTO_CHOICE_KEY, 'sw')
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
  // 0.7.0 前导留白：视频帧数 = 音频时长 + lead；lead 段画面=黑场/标题卡（introOutro 时间函数），
  // 频谱/踩点等音频驱动量按 audioT = t − lead 采样（lead 内全静音柱）。
  const leadSec = layout.audio.leadMs > 0 ? layout.audio.leadMs / 1000 : 0
  const totalFrames = Math.max(1, Math.round((durationMs / 1000 + leadSec) * fps))

  const picked = await pickEncoderConfig(
    resolution.width,
    resolution.height,
    fps,
    BITRATE_TABLE[resolution.id] ?? 10_000_000
  )
  if (!picked) {
    throw new Error(t('exporter.unsupportedH264'))
  }
  const encoderConfig = picked.config

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
    throw new Error(t('exporter.canvasFail'))
  }

  // 0.5.0 动效：存在随时间变化的特效 → 逐帧全层渲染（同一批节点）；
  // 否则走静态缓存快速路径（与 0.4.0 输出一致）。
  // 1.0.0 T7：时间轴同理——逐帧 resolve（静态段零拷贝、关键帧段逐帧插值）→ setLayout 同步应用。
  const tlActive = hasTimeline(layout)
  const dynamic = hasDynamicFx(layout) || hasCustomLayerOrder(layout) || tlActive
  const staticCanvas = dynamic ? null : stage.renderStatic()
  const fxState: SmoothFxState = { prev: null, peak: null }
  const vizCfg = layout.visualizer
  const cfxCfg = layout.canvasFx
  const cfxOn =
    cfxCfg.vignette > 0 ||
    cfxCfg.grain > 0 ||
    cfxCfg.scanline > 0 ||
    cfxCfg.beatFlash > 0 ||
    cfxCfg.lightLeak > 0
  const cfxEnergy = (tt: number): ReturnType<typeof bandEnergiesAt> =>
    bandEnergiesAt(analyzer!, tt, vizCfg.barCount, vizCfg.sensitivity)
  const tOffset = vizCfg.offsetMs / 1000
  // 频率范围以布局快照为准（分析器字段为共享可变对象：防止导出中途改滑块导致前后帧不一致）
  if (analyzer) {
    const half = Math.max(analyzer.sampleRate / 2, 1000)
    const lo = Math.min(Math.max(vizCfg.freqMin, 1), half - 1)
    analyzer.freqMin = lo
    analyzer.freqMax = Math.min(half, Math.max(vizCfg.freqMax, lo + 1))
  }
  const frameMs: number[] = []
  const totalT0 = performance.now()

  onProgress({
    phase: 'encoding',
    encoded: 0,
    total: totalFrames,
    mergePercent: null,
    message: t('exporter.encoding')
  })

  try {
    for (let i = 0; i < totalFrames; i++) {
      if (signal.aborted) {
        return null
      }
      const f0 = performance.now()
      const tSec = i / fps // 画面时间轴（含 lead）
      const audioT = tSec - leadSec // 音频时间轴（频谱/踩点/呼吸的驱动时间）
      if (analyzer) {
        if (audioT < 0) {
          // 前导段：无音频 → 静默柱（0）
          const z = new Float32Array(vizCfg.barCount)
          const smoothed = smoothBarsFx(fxState, z, vizCfg.attack, vizCfg.decay, vizCfg.peakFall)
          stage.setBars(Array.from(smoothed))
        } else {
          const target = spectrumAt(
            analyzer,
            audioT + tOffset,
            vizCfg.barCount,
            null,
            vizCfg.sensitivity
          )
          const smoothed = smoothBarsFx(
            fxState,
            target,
            vizCfg.attack,
            vizCfg.decay,
            vizCfg.peakFall
          )
          stage.setBars(Array.from(smoothed))
        }
      }
      stage.setFrame(tSec)
      // 1.0.0 T7：时间轴逐帧解析（tSec = wall 总轴；片段按 wall 轴分割）并应用到导出场景
      if (tlActive) stage.setLayout(resolveLayoutAt(layout, tSec))
      if (dynamic) {
        // 全层逐帧渲染（含背景/主图/文本动效、片头片尾；同一 SceneLayers 绘制代码）
        ctx.clearRect(0, 0, resolution.width, resolution.height)
        ctx.drawImage(stage.renderFull(), 0, 0)
      } else {
        const viz = stage.renderViz()
        ctx.drawImage(staticCanvas!, 0, 0)
        ctx.drawImage(viz, 0, 0)
      }
      // 0.6.0 音乐响应：手动节拍源（beat 包络）→ 粒子爆发 + 踩点闪光（同函数）。
      // 0.7.0 lead：驱动时间 = 音频轴（audioT + offset）；音乐未开始（audioT<0）→ 不叠加（纯黑前导）。
      if (audioT >= 0) {
        const period = beatPeriod(vizCfg.bpm, vizCfg.beatIntervalSec)
        const env = period != null ? beatEnvelope(audioT + tOffset, period) : 0
        const beatCfg = layout.beat
        if (beatCfg.particleDensity > 0) {
          drawParticles(
            ctx,
            particlesAt(
              audioT + tOffset,
              beatCfg.particlePreset,
              beatCfg.particleDensity,
              env * beatCfg.burst,
              resolution.width,
              resolution.height
            )
          )
        }
        // 全局后期（CanvasFX 管线）：预览 overlay 与导出同函数（核心约束 A）
        if (cfxOn && analyzer) {
          drawCanvasFx(
            ctx,
            {
              t: audioT + tOffset,
              vignette: cfxCfg.vignette,
              grain: cfxCfg.grain,
              scanline: cfxCfg.scanline,
              beatFlash: cfxCfg.beatFlash,
              lightLeak: cfxCfg.lightLeak,
              energy: cfxEnergy,
              beatPeriodSec: period
            },
            resolution.width,
            resolution.height
          )
        }
      }
      const frame = new VideoFrame(compose, {
        timestamp: Math.round((i * 1_000_000) / fps),
        duration: Math.round(1_000_000 / fps)
      })
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 })
      frame.close()
      if (encoderError) throw encoderError
      frameMs.push(performance.now() - f0)
      let message = t('exporter.encoding')
      if ((i + 1) % 30 === 0) {
        const avg = frameMs.reduce((a, b) => a + b, 0) / frameMs.length
        const percent = Math.round(((i + 1) / totalFrames) * 100)
        message = t('exporter.encodingProgress', {
          p: percent,
          ms: Math.round(avg)
        })
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
      message: t('exporter.encodeDone', { s: Math.round(totalMs / 1000) })
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
