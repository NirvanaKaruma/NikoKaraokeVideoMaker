import { useEffect, useRef, useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import type Konva from 'konva'
import {
  BeatFxConfig,
  CanvasFxConfig,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  NormRect,
  ProjectLayout,
  VisualizerConfig
} from '@shared/layout'
import { bandEnergiesAt, type SpectrumAnalyzer } from '@shared/spectrum'
import { drawCanvasFx, type CanvasFxDrawOpts } from '@shared/canvasfx'
import { beatEnvelope, beatPeriod } from '@shared/fx'
import { drawParticles, particlesAt } from '@shared/particles'
import { SceneLayers, SelectableId } from './SceneLayers'
import type { CanvasImageElement } from '../hooks/useProject'

/** 非可视化动效帧分发（背景/主图/文本每帧更新）；第二参 audioT 为音频轴（预览缺省 = t） */
export type LayerFxRef = { current: ((t: number, audioT?: number) => void) | null }

/** 全局后期叠加（0.5.0）：独立 2D canvas 置于 Konva 舞台之上，rAF 自绘（有动效才跑）；
 * 与导出 compose 共用 drawCanvasFx（核心约束 A）。 */
function CanvasFxOverlay({
  canvasFx,
  beat,
  visualizer,
  analyzer,
  playTimeRef,
  scale,
  offX,
  offY
}: {
  canvasFx: CanvasFxConfig
  beat: BeatFxConfig
  visualizer: VisualizerConfig
  analyzer?: SpectrumAnalyzer | null
  playTimeRef?: { current: number }
  scale: number
  offX: number
  offY: number
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const lastSigRef = useRef<string>('')
  const enabled =
    canvasFx.vignette > 0 ||
    canvasFx.grain > 0 ||
    canvasFx.scanline > 0 ||
    canvasFx.beatFlash > 0 ||
    canvasFx.lightLeak > 0 ||
    beat.particleDensity > 0

  useEffect(() => {
    if (!enabled) return
    let raf = 0
    const draw = (): void => {
      raf = requestAnimationFrame(draw)
      // 空闲跳过：暂停/未加载且信号未变时整帧跳过（省全画布 clear+重绘）
      const offset = visualizer.offsetMs / 1000
      const t = (playTimeRef?.current ?? 0) + offset
      const sig = [
        t,
        canvasFx.vignette,
        canvasFx.grain,
        canvasFx.scanline,
        canvasFx.beatFlash,
        canvasFx.lightLeak,
        beat.pulse,
        beat.burst,
        beat.particlePreset,
        beat.particleDensity,
        visualizer.bpm,
        visualizer.beatIntervalSec,
        analyzer ? 1 : 0
      ].join('|')
      if (sig === lastSigRef.current) return
      lastSigRef.current = sig
      const c = canvasRef.current
      if (!c) return
      const ctx = c.getContext('2d')
      if (!ctx) return
      ctx.clearRect(0, 0, c.width, c.height)
      const period = beatPeriod(visualizer.bpm, visualizer.beatIntervalSec)
      const env = period != null ? beatEnvelope(t, period) : 0
      // 粒子：beat 爆发 boost（音乐响应）
      if (beat.particleDensity > 0) {
        const particles = particlesAt(
          t,
          beat.particlePreset,
          beat.particleDensity,
          env * beat.burst,
          c.width,
          c.height
        )
        drawParticles(ctx, particles)
      }
      const feed: CanvasFxDrawOpts = {
        t,
        vignette: canvasFx.vignette,
        grain: canvasFx.grain,
        scanline: canvasFx.scanline,
        beatFlash: canvasFx.beatFlash,
        lightLeak: canvasFx.lightLeak,
        energy: analyzer
          ? (tt: number) =>
              bandEnergiesAt(analyzer, tt + offset, visualizer.barCount, visualizer.sensitivity)
          : undefined,
        beatPeriodSec: period,
        leakSprite: undefined
      }
      drawCanvasFx(ctx, feed, c.width, c.height)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [enabled, canvasFx, beat, visualizer, analyzer, playTimeRef])

  return (
    <canvas
      ref={canvasRef}
      className="fx-overlay"
      width={LOGICAL_WIDTH}
      height={LOGICAL_HEIGHT}
      style={{
        width: LOGICAL_WIDTH * scale,
        height: LOGICAL_HEIGHT * scale,
        left: offX,
        top: offY
      }}
    />
  )
}

export interface CanvasStageProps {
  layout: ProjectLayout
  coverElement: CanvasImageElement | null
  bgElement: CanvasImageElement | null
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
  onTextRectChange: (kind: 'songTitle' | 'artist', rect: NormRect) => void
  onVisualizerRectChange: (rect: NormRect) => void
  bars: number[]
  /** 播放中命令式更新频谱柱（性能优化：绕过 React 每帧重渲染） */
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
  /** 播放中命令式更新帧时间（动效：flow 相位等） */
  frameTRef?: { current: ((t: number) => void) | null }
  /** 共享频谱分析器（动效层按时间 t 计算分带能量；预览/导出同一数据源） */
  analyzer?: SpectrumAnalyzer | null
  /** 非可视化动效帧分发（背景/主图/文本每帧更新） */
  layerFxRef?: LayerFxRef
  /** 音频总时长秒（片尾时间轴用） */
  mediaDurationSec?: number
  /** 播放时间值盒（CanvasFX overlay 等 rAF 自绘组件读取最新 t） */
  playTimeRef?: { current: number }
  onStageReady?: (stage: Konva.Stage | null) => void
}

/** 1920×1080 逻辑画布按容器自适应缩放并居中显示 */
export function CanvasStage(props: CanvasStageProps): React.JSX.Element {
  const {
    layout,
    coverElement,
    bgElement,
    selectedId,
    onSelect,
    onMainRectChange,
    onTextRectChange,
    onVisualizerRectChange,
    bars,
    barsHandleRef,
    frameTRef,
    analyzer,
    layerFxRef,
    mediaDurationSec,
    playTimeRef,
    onStageReady
  } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Konva.Stage>(null)
  const [box, setBox] = useState({ w: 960, h: 540 })

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect
      setBox({ w: r.width, h: r.height })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    onStageReady?.(stageRef.current)
  }, [onStageReady])

  const scale = Math.min(box.w / LOGICAL_WIDTH, box.h / LOGICAL_HEIGHT)
  const offX = (box.w - LOGICAL_WIDTH * scale) / 2
  const offY = (box.h - LOGICAL_HEIGHT * scale) / 2

  return (
    <div ref={containerRef} className="canvas-container">
      <CanvasFxOverlay
        canvasFx={layout.canvasFx}
        beat={layout.beat}
        visualizer={layout.visualizer}
        analyzer={analyzer}
        playTimeRef={playTimeRef}
        scale={scale}
        offX={offX}
        offY={offY}
      />
      <Stage
        ref={stageRef}
        width={box.w}
        height={box.h}
        scaleX={scale}
        scaleY={scale}
        x={offX}
        y={offY}
        onMouseDown={(e) => {
          if (e.target === e.target.getStage()) onSelect(null)
        }}
        onTouchStart={(e) => {
          if (e.target === e.target.getStage()) onSelect(null)
        }}
      >
        <Layer listening={false}>
          <Rect
            x={0}
            y={0}
            width={LOGICAL_WIDTH}
            height={LOGICAL_HEIGHT}
            fill="#0d0d12"
            listening={false}
          />
        </Layer>
        <SceneLayers
          layout={layout}
          coverElement={coverElement}
          bgElement={bgElement}
          selectedId={selectedId}
          onSelect={onSelect}
          onMainRectChange={onMainRectChange}
          onTextRectChange={onTextRectChange}
          onVisualizerRectChange={onVisualizerRectChange}
          bars={bars}
          barsHandleRef={barsHandleRef}
          frameTRef={frameTRef}
          analyzer={analyzer}
          layerFxRef={layerFxRef}
          mediaDurationSec={mediaDurationSec}
        />
      </Stage>
    </div>
  )
}
