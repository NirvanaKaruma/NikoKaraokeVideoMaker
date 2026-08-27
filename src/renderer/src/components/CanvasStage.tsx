import { useEffect, useRef, useState } from 'react'
import { Layer, Rect, Stage } from 'react-konva'
import type Konva from 'konva'
import { LOGICAL_HEIGHT, LOGICAL_WIDTH, NormRect, ProjectLayout } from '@shared/layout'
import { SceneLayers, SelectableId } from './SceneLayers'

export interface CanvasStageProps {
  layout: ProjectLayout
  coverElement: HTMLImageElement | null
  bgElement: HTMLImageElement | null
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
  onTextRectChange: (kind: 'songTitle' | 'artist', rect: NormRect) => void
  onVisualizerRectChange: (rect: NormRect) => void
  bars: number[]
  /** 播放中命令式更新频谱柱（性能优化：绕过 React 每帧重渲染） */
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
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
        />
      </Stage>
    </div>
  )
}
