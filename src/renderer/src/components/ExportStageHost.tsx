import { useEffect, useRef } from 'react'
import { Stage } from 'react-konva'
import type Konva from 'konva'
import type { ProjectLayout } from '@shared/layout'
import { SceneLayers } from './SceneLayers'

export interface ExportStageHandle {
  /** 静态层（背景/主图/文本）合成画布 */
  renderStatic: () => HTMLCanvasElement
  /** 命令式更新频谱柱（同一批 Konva 节点 = 同一绘制代码） */
  setBars: (bars: number[]) => void
  /** 可视化层画布 */
  renderViz: () => HTMLCanvasElement
}

interface ExportStageHostProps {
  layout: ProjectLayout
  coverElement: HTMLImageElement | null
  bgElement: HTMLImageElement | null
  width: number
  height: number
  onReady: (handle: ExportStageHandle) => void
}

/**
 * 导出用隐藏舞台（离屏）：静态层与可视化层拆成两个 Stage，
 * 每帧 = 静态画布 + setBars 后的可视化画布。复用 SceneLayers（核心约束 A）。
 */
export function ExportStageHost(props: ExportStageHostProps): React.JSX.Element {
  const { layout, coverElement, bgElement, width, height, onReady } = props
  const staticRef = useRef<Konva.Stage>(null)
  const vizRef = useRef<Konva.Stage>(null)
  const barsHandleRef = useRef<((bars: number[]) => void) | null>(null)

  useEffect(() => {
    // 等 Konva 挂载 + 背景模糊缓存完成后交付句柄
    const t = setTimeout(() => {
      const s = staticRef.current
      const v = vizRef.current
      if (s && v && barsHandleRef.current) {
        s.draw()
        onReady({
          renderStatic: () => s.toCanvas({ pixelRatio: 1 }),
          setBars: (bars) => barsHandleRef.current?.(bars),
          renderViz: () => v.toCanvas({ pixelRatio: 1 })
        })
      }
    }, 500)
    return () => clearTimeout(t)
  }, [layout, coverElement, width, height, onReady])

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
          canvasSize={{ width, height }}
          layers={['background', 'main', 'text']}
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
          canvasSize={{ width, height }}
          layers={['visualizer']}
          barsHandleRef={barsHandleRef}
        />
      </Stage>
    </div>
  )
}
