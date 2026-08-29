import { useEffect, useRef } from 'react'
import { Stage } from 'react-konva'
import type Konva from 'konva'
import type { ProjectLayout } from '@shared/layout'
import type { SpectrumAnalyzer } from '@shared/spectrum'
import { SceneLayers } from './SceneLayers'
import type { CanvasImageElement } from '../hooks/useProject'

export interface ExportStageHandle {
  /** 静态层（背景/主图/文本）合成画布（无动态动效的快速路径） */
  renderStatic: () => HTMLCanvasElement
  /** 命令式更新频谱柱（同一批 Konva 节点 = 同一绘制代码） */
  setBars: (bars: number[]) => void
  /** 动效帧时间（秒）：flow 相位 + 背景/主图/文本/片头片尾每帧更新 */
  setFrame: (t: number) => void
  /** 可视化层画布 */
  renderViz: () => HTMLCanvasElement
  /** 全层渲染画布（存在动态动效时逐帧调用：所有层同一批节点 = 同一绘制代码） */
  renderFull: () => HTMLCanvasElement
}

interface ExportStageHostProps {
  layout: ProjectLayout
  coverElement: CanvasImageElement | null
  bgElement: CanvasImageElement | null
  /** 共享频谱分析器（动效层按 t 计算分带能量） */
  analyzer?: SpectrumAnalyzer | null
  /** 音频总时长秒（片尾时间轴用） */
  mediaDurationSec?: number
  /** 前导留白秒（0.7.0）：setFrame 内部把音频驱动量换算到音频轴（audioT = max(0, t − lead)） */
  audioLeadSec?: number
  /** 附加层图像元素（0.8.0）：layerId → 解码后元素 */
  overlayElements?: Record<string, CanvasImageElement | null>
  width: number
  height: number
  onReady: (handle: ExportStageHandle) => void
}

/** 导出场景内部动效分发（setFrame(t, audioT) 驱动；与预览的 layerFxRef 相互独立） */
export type LayerFxRef = { current: ((t: number, audioT?: number) => void) | null }

/**
 * 导出用隐藏舞台（离屏）：静态层与可视化层拆成两个 Stage，
 * 每帧 = 静态画布 + setBars 后的可视化画布。复用 SceneLayers（核心约束 A）。
 */
export function ExportStageHost(props: ExportStageHostProps): React.JSX.Element {
  const {
    layout,
    coverElement,
    bgElement,
    analyzer,
    mediaDurationSec,
    audioLeadSec,
    overlayElements,
    width,
    height,
    onReady
  } = props
  const leadSec = Math.max(0, audioLeadSec ?? 0)
  const staticRef = useRef<Konva.Stage>(null)
  const vizRef = useRef<Konva.Stage>(null)
  const fullRef = useRef<Konva.Stage>(null)
  const barsHandleRef = useRef<((bars: number[]) => void) | null>(null)
  const frameTHandleRef = useRef<((t: number) => void) | null>(null)
  const fxStaticHandleRef = useRef<((t: number, audioT?: number) => void) | null>(null)
  const fxVizHandleRef = useRef<((t: number, audioT?: number) => void) | null>(null)
  const fullBarsHandleRef = useRef<((bars: number[]) => void) | null>(null)
  const fullFrameTHandleRef = useRef<((t: number) => void) | null>(null)
  const fullFxHandleRef = useRef<((t: number, audioT?: number) => void) | null>(null)

  useEffect(() => {
    // 等 Konva 挂载 + 背景模糊缓存完成后交付句柄
    const t = setTimeout(() => {
      const s = staticRef.current
      const v = vizRef.current
      const f = fullRef.current
      if (s && v && f && barsHandleRef.current) {
        s.draw()
        onReady({
          renderStatic: () => s.toCanvas({ pixelRatio: 1 }),
          setBars: (bars) => {
            barsHandleRef.current?.(bars)
            fullBarsHandleRef.current?.(bars)
          },
          setFrame: (tt) => {
            // 0.7.0：tt 为总轴（含 lead）；音频驱动量（频谱/踩点/呼吸）按 audioT 分发，
            // 连续运镜/文本入场仍走 wall 轴 tt（前导期间不冻结）。preview 侧 audioT = t（无 lead）。
            const at = Math.max(0, tt - leadSec)
            fxStaticHandleRef.current?.(tt, at)
            fxVizHandleRef.current?.(tt, at)
            frameTHandleRef.current?.(at)
            fullFxHandleRef.current?.(tt, at)
            fullFrameTHandleRef.current?.(at)
          },
          renderViz: () => v.toCanvas({ pixelRatio: 1 }),
          renderFull: () => f.toCanvas({ pixelRatio: 1 })
        })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [layout, coverElement, width, height, onReady, leadSec])

  const noop = (): void => undefined

  return (
    <div
      style={{
        position: 'fixed',
        left: -20000,
        top: 0,
        pointerEvents: 'none',
        visibility: 'hidden'
      }}
      aria-hidden
    >
      <Stage ref={staticRef} width={width} height={height}>
        <SceneLayers
          layout={layout}
          coverElement={coverElement}
          bgElement={bgElement}
          selectedId={null}
          onSelect={noop}
          onMainRectChange={noop}
          onTextRectChange={noop}
          onVisualizerRectChange={noop}
          bars={[]}
          analyzer={analyzer}
          canvasSize={{ width, height }}
          layers={['background', 'main', 'overlay', 'text']}
          layerFxRef={fxStaticHandleRef}
          audioLeadSec={leadSec}
          mediaDurationSec={mediaDurationSec}
          overlayElements={overlayElements}
          onOverlayRectChange={noop}
        />
      </Stage>
      <Stage ref={vizRef} width={width} height={height}>
        <SceneLayers
          layout={layout}
          coverElement={coverElement}
          bgElement={bgElement}
          selectedId={null}
          onSelect={noop}
          onMainRectChange={noop}
          onTextRectChange={noop}
          onVisualizerRectChange={noop}
          bars={Array(layout.visualizer.barCount).fill(0)}
          analyzer={analyzer}
          canvasSize={{ width, height }}
          layers={['visualizer', 'fx']}
          barsHandleRef={barsHandleRef}
          frameTRef={frameTHandleRef}
          layerFxRef={fxVizHandleRef}
          audioLeadSec={leadSec}
          mediaDurationSec={mediaDurationSec}
          overlayElements={overlayElements}
          onOverlayRectChange={noop}
        />
      </Stage>
      <Stage ref={fullRef} width={width} height={height}>
        <SceneLayers
          layout={layout}
          coverElement={coverElement}
          bgElement={bgElement}
          selectedId={null}
          onSelect={noop}
          onMainRectChange={noop}
          onTextRectChange={noop}
          onVisualizerRectChange={noop}
          bars={Array(layout.visualizer.barCount).fill(0)}
          analyzer={analyzer}
          canvasSize={{ width, height }}
          barsHandleRef={fullBarsHandleRef}
          frameTRef={fullFrameTHandleRef}
          layerFxRef={fullFxHandleRef}
          audioLeadSec={leadSec}
          mediaDurationSec={mediaDurationSec}
          overlayElements={overlayElements}
          onOverlayRectChange={noop}
        />
      </Stage>
    </div>
  )
}
