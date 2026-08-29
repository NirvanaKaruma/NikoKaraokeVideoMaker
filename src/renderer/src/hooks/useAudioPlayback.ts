import { useCallback, useEffect, useRef, useState } from 'react'
import type { VisualizerConfig } from '@shared/layout'
import {
  createSpectrumAnalyzer,
  mixToMono,
  spectrumAt,
  type SpectrumAnalyzer
} from '@shared/spectrum'
import { smoothBarsFx, type SmoothFxState } from '@shared/fx'
import { placeholderBars } from '@shared/color'
import { t } from '@shared/i18n'

export type AudioStatus = 'empty' | 'loading' | 'ready' | 'error'

/** Worker 解码结果：多声道（播放）+ 单声道混音（频谱分析），全部纯 typed array transfer 回传 */
export interface WorkerDecodeResult {
  channels: Float32Array[]
  mono: Float32Array
  sampleRate: number
}

let decodeWorkerInst: Worker | null = null

/** Worker 消息统一解析：{ok, channels, mono, sampleRate} 经 transfer 回传 */
function parseWorkerResult(e: MessageEvent): WorkerDecodeResult | null {
  const r = e.data as {
    ok?: boolean
    channels?: Float32Array[]
    mono?: Float32Array
    sampleRate?: number
  }
  if (r.ok && r.channels && r.channels.length > 0 && r.mono && (r.sampleRate ?? 0) > 0) {
    return { channels: r.channels, mono: r.mono, sampleRate: r.sampleRate ?? 0 }
  }
  return null
}

/**
 * 路径①：ffmpeg 子进程流式解码（main）→ PCM 4MB 块 transfer 直通 Worker，
 * 拼接/拆声道/混单声道全部在 Worker 内完成（纯数据操作，零 WebAudio——实测本环境
 * Worker 无 AudioBuffer/OfflineAudioContext）。主线程只剩 createBuffer+copyToChannel
 * （实测 0–11ms），消除了「preload 全量组装 + contextBridge 大块克隆 + 主线程混音」
 * 的 GC 卡顿源。cancel：终止 Worker + 取消 main 侧 ffmpeg 子进程。
 */
function startPcmStreamDecode(decodePath: string): {
  promise: Promise<WorkerDecodeResult | null>
  cancel: () => void
} {
  let settleFn: ((r: WorkerDecodeResult | null) => void) | null = null
  const promise = new Promise<WorkerDecodeResult | null>((resolve) => {
    settleFn = resolve
  })
  let w: Worker | null = null
  let settled = false
  const done = (r: WorkerDecodeResult | null): void => {
    if (settled) return
    settled = true
    w?.terminate()
    if (decodeWorkerInst === w) decodeWorkerInst = null
    settleFn?.(r)
  }
  try {
    decodeWorkerInst?.terminate()
    w = new Worker(new URL('../workers/audioDecode.worker.ts', import.meta.url), {
      type: 'module'
    })
    decodeWorkerInst = w
    w.onmessage = (e: MessageEvent): void => done(parseWorkerResult(e))
    w.onerror = (): void => done(null)
    const session = window.api.project.audioDecode(decodePath, (chunk: ArrayBuffer) => {
      // 块 transfer 进 Worker（零拷贝）；Worker 已终止则忽略
      try {
        w?.postMessage({ type: 'chunk', data: chunk }, [chunk])
      } catch {
        done(null)
      }
    })
    void session.result.then((res) => {
      if (settled) return
      if (res.ok && res.channels > 0 && res.sampleRate > 0) {
        try {
          w?.postMessage({ type: 'finalize', channels: res.channels, sampleRate: res.sampleRate })
        } catch {
          done(null)
        }
      } else {
        done(null)
      }
    })
    return {
      promise,
      cancel: (): void => {
        done(null)
        session.cancel()
      }
    }
  } catch {
    done(null)
    return { promise, cancel: (): void => undefined }
  }
}

export interface PlaybackApi {
  status: AudioStatus
  error: string | null
  duration: number
  currentTime: number
  isPlaying: boolean
  /** 0–1 频谱柱高度（长度 = config.barCount）；无音频时为占位柱 */
  bars: number[]
  /** 共享频谱分析器（导出编码使用）；无音频时为 null */
  analyzer: SpectrumAnalyzer | null
  play: () => void
  pause: () => void
  seek: (t: number) => void
}

/**
 * 音频播放 + 频谱驱动（M3/T14）。
 * - 解码：File.arrayBuffer → AudioContext.decodeAudioData → 混单声道 → 共享频谱分析器
 * - 播放：AudioBufferSourceNode 手动控制（offset 记录实现暂停/续播/seek），播完停止
 * - 频谱：rAF 每帧 spectrumAt(currentTime) + 时间平滑；seek 后立即刷新
 */
export function useAudioPlayback(
  audioFile: File | null,
  config: VisualizerConfig,
  /** 播放中走命令式更新（绕过 React 每帧重渲染）；缺省回退 setBars */
  barsSink?: { current: ((bars: number[]) => void) | null },
  /** 播放中同步帧时间（动效：flow 相位等） */
  frameTSink?: { current: ((t: number) => void) | null },
  /** 播放中同步帧时间（动效：背景/主图/文本层每帧更新）；第二参 audioT 为音频轴（预览 = t） */
  layerFxSink?: { current: ((t: number, audioT?: number) => void) | null },
  /** 播放时间值盒（CanvasFX overlay 等 rAF 自绘组件读取最新 t） */
  timeBoxRef?: { current: number }
): PlaybackApi {
  const ctxRef = useRef<AudioContext | null>(null)
  const bufferRef = useRef<AudioBuffer | null>(null)
  const analyzerRef = useRef<SpectrumAnalyzer | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startedAtRef = useRef(0)
  const offsetRef = useRef(0)
  const playingRef = useRef(false)
  const manualStopRef = useRef(false)
  const smoothFxRef = useRef<SmoothFxState>({ prev: null, peak: null })
  const lastBarsRef = useRef<Float32Array | null>(null)
  const configRef = useRef(config)
  const sinkRef = useRef(barsSink)
  const frameTSinkRef = useRef(frameTSink)
  const layerFxSinkRef = useRef(layerFxSink)
  const timeBoxRefStable = useRef(timeBoxRef)
  useEffect(() => {
    timeBoxRefStable.current = timeBoxRef
  }, [timeBoxRef])

  useEffect(() => {
    sinkRef.current = barsSink
  }, [barsSink])

  useEffect(() => {
    frameTSinkRef.current = frameTSink
  }, [frameTSink])

  useEffect(() => {
    layerFxSinkRef.current = layerFxSink
  }, [layerFxSink])

  const [status, setStatus] = useState<AudioStatus>('empty')
  const [error, setError] = useState<string | null>(null)
  const [duration, setDuration] = useState(0)
  const [currentTime, setCurrentTime] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [bars, setBars] = useState<number[]>(() => placeholderBars(config.barCount))
  const [analyzer, setAnalyzer] = useState<SpectrumAnalyzer | null>(null)

  useEffect(() => {
    configRef.current = config
  }, [config])

  const ensureCtx = (): AudioContext | null => {
    if (!ctxRef.current) {
      try {
        ctxRef.current = new AudioContext()
      } catch {
        return null
      }
    }
    return ctxRef.current
  }

  /** 频率范围校验（与 spectrum.ts 同一钳制逻辑，供解码/配置同步共用） */
  const normalizeFreqRange = useCallback((freqMin: number, freqMax: number, sampleRate: number) => {
    const half = sampleRate > 0 ? sampleRate / 2 : 24000
    const lo = Math.max(1, Math.min(freqMin, half - 1))
    let hi = Math.min(half, Math.max(freqMax, lo + 1))
    if (hi <= lo) hi = Math.min(half, lo + 1)
    return { freqMin: lo, freqMax: hi }
  }, [])

  const computeBars = useCallback((t: number, viaState: boolean) => {
    if (timeBoxRefStable.current) timeBoxRefStable.current.current = t
    const an = analyzerRef.current
    if (!an) return
    const cfg = configRef.current
    // 可视化-音频偏移校准：仅可视化时间轴偏移 ms，音频播放不动
    const tVis = t + cfg.offsetMs / 1000
    const target = spectrumAt(an, tVis, cfg.barCount, null, cfg.sensitivity)
    const smoothed = smoothBarsFx(smoothFxRef.current, target, cfg.attack, cfg.decay, cfg.peakFall)
    lastBarsRef.current = smoothed
    const arr = Array.from(smoothed)
    if (viaState || !sinkRef.current?.current) {
      setBars(arr) // 命令式通道失效时回退 React state（预览始终更新）
    } else {
      sinkRef.current.current(arr)
    }
  }, [])

  const startSource = useCallback((ctx: AudioContext, offset: number): void => {
    const buf = bufferRef.current
    if (!buf) return
    const src = ctx.createBufferSource()
    src.buffer = buf
    src.connect(ctx.destination)
    manualStopRef.current = false
    src.onended = () => {
      // 身份守卫：seek/暂停替换过的旧音源的事件一律忽略（曾误判为自然播完）
      if (src !== sourceRef.current) return
      sourceRef.current = null
      if (!manualStopRef.current) {
        // 自然播完：停止，指针停在结尾（Q5：播完停止不循环）
        playingRef.current = false
        offsetRef.current = buf.duration
        setIsPlaying(false)
        setCurrentTime(buf.duration)
      }
    }
    src.start(0, offset)
    startedAtRef.current = ctx.currentTime
    sourceRef.current = src
    playingRef.current = true
    setIsPlaying(true)
  }, [])

  // 解码（音频文件变化时）：统一走异步路径，cancelled 守护竞态。
  // 路径①：ffmpeg 子进程流式解码（首选）→ Worker 纯数据拆声道/混音 → 主线程 createBuffer；
  // 路径②（无 ffmpeg / ①失败时）：主线程 decodeAudioData（解码在 Chromium 内部异步完成）。
  useEffect(() => {
    let cancelled = false
    let cancelDecode: (() => void) | null = null
    void (async () => {
      if (!audioFile) {
        bufferRef.current = null
        analyzerRef.current = null
        offsetRef.current = 0
        smoothFxRef.current = { prev: null, peak: null }
        if (cancelled) return
        setStatus('empty')
        setDuration(0)
        setCurrentTime(0)
        setAnalyzer(null)
        setBars(placeholderBars(configRef.current.barCount))
        return
      }
      if (cancelled) return
      setStatus('loading')
      setError(null)
      try {
        const ab = await audioFile.arrayBuffer()
        const ctx = ensureCtx()
        if (!ctx) throw new Error(t('playback.noWebAudio'))
        let result: WorkerDecodeResult | null = null
        // 路径①：ffmpeg 子进程解码。拖放文件走磁盘路径；
        // 无路径来源（内存生成/粘贴）先写临时文件再交给 ffmpeg。
        let decodePath = window.api.getFilePath(audioFile)
        if (!decodePath) {
          try {
            decodePath = await window.api.exportApi.saveAudio(
              ab,
              'decode-' + Date.now() + '.' + (audioFile.name.split('.').pop() ?? 'bin')
            )
          } catch {
            decodePath = ''
          }
        }
        if (decodePath) {
          try {
            const s = startPcmStreamDecode(decodePath)
            cancelDecode = s.cancel
            result = await s.promise
          } catch {
            result = null
          }
          cancelDecode = null
          // 等待期间被取消（换文件/新建项目）→ 直接退出，不再跑回退路径
          if (cancelled) return
        }
        let decoded: AudioBuffer
        let mono: Float32Array
        let sampleRate: number
        if (result) {
          // Worker 已拆好声道 + 混好单声道；主线程只 createBuffer+copy（实测 0–11ms）
          decoded = ctx.createBuffer(
            result.channels.length,
            result.channels[0].length,
            result.sampleRate
          )
          for (let c = 0; c < result.channels.length; c++) {
            decoded.copyToChannel(result.channels[c] as Float32Array<ArrayBuffer>, c)
          }
          mono = result.mono
          sampleRate = result.sampleRate
        } else {
          // 路径②：最后兜底——decodeAudioData（仅无 ffmpeg / 流式失败时；异步解码不阻塞 UI）
          decoded = await ctx.decodeAudioData(ab)
          const channels: Float32Array[] = []
          for (let c = 0; c < decoded.numberOfChannels; c++) {
            channels.push(decoded.getChannelData(c))
          }
          mono = mixToMono(channels, decoded.length)
          sampleRate = decoded.sampleRate
        }
        if (cancelled) return
        bufferRef.current = decoded
        // 频率范围取自布局配置（预览与导出共用同一分析器 → 所见即所得）
        const range = normalizeFreqRange(
          configRef.current.freqMin,
          configRef.current.freqMax,
          sampleRate
        )
        const an = createSpectrumAnalyzer(mono, sampleRate, {
          freqMin: range.freqMin,
          freqMax: range.freqMax
        })
        analyzerRef.current = an
        setAnalyzer(an)
        offsetRef.current = 0
        setDuration(decoded.duration)
        setStatus('ready')
        setError(null)
        setCurrentTime(0)
        // 立即显示 t=0 频谱
        computeBars(0, true)
      } catch (e) {
        if (!cancelled) {
          setStatus('error')
          setError(t('playback.decodeFailed', { err: String(e) }))
        }
      }
    })()
    return () => {
      cancelled = true
      // 取消在途解码：终止 Worker + 杀掉 main 侧 ffmpeg 子进程
      //（换文件 / 新建项目时不再有空转的解码流与内存驻留）
      cancelDecode?.()
    }
  }, [audioFile, computeBars, normalizeFreqRange])

  const play = useCallback(() => {
    const ctx = ensureCtx()
    if (!ctx || !bufferRef.current) return
    if (playingRef.current) return
    // 播完后再点播放 → 从头开始
    if (offsetRef.current >= bufferRef.current.duration - 0.01) offsetRef.current = 0
    void ctx.resume()
    startSource(ctx, offsetRef.current)
  }, [startSource])

  const pause = useCallback(() => {
    const ctx = ctxRef.current
    if (!ctx || !playingRef.current) return
    manualStopRef.current = true
    offsetRef.current += ctx.currentTime - startedAtRef.current
    sourceRef.current?.stop()
    sourceRef.current = null
    playingRef.current = false
    setIsPlaying(false)
    setCurrentTime(offsetRef.current)
    // command 路径下同步最后一帧（lastBars / lastT）到 state/渲染侧，
    // 避免后续声明式重渲染回退到旧值（flow 相位与暂停点一致，防突变）
    if (lastBarsRef.current) setBars(Array.from(lastBarsRef.current))
    frameTSinkRef.current?.current?.(offsetRef.current)
    layerFxSinkRef.current?.current?.(offsetRef.current)
  }, [])

  const seek = useCallback(
    (t: number) => {
      const buf = bufferRef.current
      if (!buf) return
      const clamped = Math.min(Math.max(t, 0), buf.duration)
      if (playingRef.current) {
        const ctx = ctxRef.current
        if (ctx) {
          manualStopRef.current = true
          sourceRef.current?.stop()
          sourceRef.current = null
          startSource(ctx, clamped)
        }
      }
      offsetRef.current = clamped
      setCurrentTime(clamped)
      // 同步可视化帧时间（flow 相位/动效跟随 seek 后时间轴，避免突变）
      frameTSinkRef.current?.current?.(clamped)
      layerFxSinkRef.current?.current?.(clamped)
      computeBars(clamped, true)
    },
    [computeBars, startSource]
  )

  // rAF：播放中逐帧驱动频谱与进度
  useEffect(() => {
    if (!isPlaying) return
    let raf = 0
    const tick = (): void => {
      const ctx = ctxRef.current
      if (!ctx || !playingRef.current) return
      const t = offsetRef.current + (ctx.currentTime - startedAtRef.current)
      const dur = bufferRef.current?.duration ?? t
      setCurrentTime(Math.min(t, dur))
      computeBars(t, false)
      frameTSinkRef.current?.current?.(t)
      layerFxSinkRef.current?.current?.(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [isPlaying, computeBars])

  // 柱数变化且无音频时重置占位柱
  useEffect(() => {
    if (status === 'empty') {
      setBars(placeholderBars(configRef.current.barCount))
    }
  }, [config.barCount, status])

  // 可视化配置变化（柱数/频率范围/灵敏度）：同步分析器并立即按当前时刻重算。
  // 修复：暂停态改柱数只重排槽位（老旧柱数组被挤进新槽位 → 看起来"拉宽/压扁"），
  // 现在无论播放与否都得到与新配置一致的分桶结构。
  useEffect(() => {
    const an = analyzerRef.current
    if (!an) return
    const range = normalizeFreqRange(config.freqMin, config.freqMax, an.sampleRate)
    if (an.freqMin !== range.freqMin || an.freqMax !== range.freqMax) {
      an.freqMin = range.freqMin
      an.freqMax = range.freqMax
    }
    if (status === 'ready') {
      computeBars(offsetRef.current, true)
    }
  }, [
    config.barCount,
    config.freqMin,
    config.freqMax,
    config.sensitivity,
    status,
    computeBars,
    normalizeFreqRange
  ])

  return {
    status,
    error,
    duration,
    currentTime,
    isPlaying,
    bars,
    analyzer,
    play,
    pause,
    seek
  }
}
