import { useEffect, useRef } from 'react'
import {
  Group,
  Image as KonvaImage,
  Layer,
  Rect,
  Text as KonvaText,
  Transformer
} from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Blur } from 'konva/lib/filters/Blur'
import {
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  NormRect,
  ProjectLayout,
  TextLayerConfig,
  VisualizerConfig,
  normToPixel,
  pixelToNorm,
  relToPixel
} from '@shared/layout'
import { colorAt, placeholderBars } from '@shared/color'

const CANVAS = { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }

export interface SceneLayersProps {
  layout: ProjectLayout
  coverElement: HTMLImageElement | null
  selectedId: 'mainImage' | null
  onSelect: (id: 'mainImage' | null) => void
  onMainRectChange: (rect: NormRect) => void
}

/** 背景层：背景色（透明图合成基底）+ 封面铺满 + 高斯模糊 + 压暗遮罩 */
function BackgroundLayer({
  background,
  coverElement
}: {
  background: ProjectLayout['background']
  coverElement: HTMLImageElement | null
}): React.JSX.Element {
  const bgRef = useRef<Konva.Group>(null)
  const blurRadius = (background.blur / 100) * 60
  const showBlur = background.blur > 0

  let cover: React.JSX.Element | null = null
  if (background.useImage && coverElement) {
    const iw = coverElement.naturalWidth || coverElement.width
    const ih = coverElement.naturalHeight || coverElement.height
    if (iw > 0 && ih > 0) {
      const s = Math.max(LOGICAL_WIDTH / iw, LOGICAL_HEIGHT / ih)
      cover = (
        <KonvaImage
          image={coverElement}
          x={(LOGICAL_WIDTH - iw * s) / 2}
          y={(LOGICAL_HEIGHT - ih * s) / 2}
          width={iw * s}
          height={ih * s}
          listening={false}
        />
      )
    }
  }

  // 透明图先与背景色合成（rect+image 同组），整组缓存后统一模糊
  useEffect(() => {
    const node = bgRef.current
    if (node) {
      node.cache()
      node.getLayer()?.batchDraw()
    }
  }, [background.useImage, background.color, background.blur, coverElement])

  return (
    <>
      <Group ref={bgRef} filters={showBlur ? [Blur] : []} blurRadius={blurRadius}>
        <Rect
          x={0}
          y={0}
          width={LOGICAL_WIDTH}
          height={LOGICAL_HEIGHT}
          fill={background.color}
          listening={false}
        />
        {cover}
      </Group>
      {background.dimOpacity > 0 && (
        <Rect
          x={0}
          y={0}
          width={LOGICAL_WIDTH}
          height={LOGICAL_HEIGHT}
          fill="#000000"
          opacity={background.dimOpacity}
          listening={false}
        />
      )}
    </>
  )
}

/** 文本层：歌曲名/作者，字号等相对画布高 */
function TextNode({ cfg }: { cfg: TextLayerConfig }): React.JSX.Element {
  const px = normToPixel(cfg.rect, CANVAS)
  const { style } = cfg
  return (
    <KonvaText
      x={px.x}
      y={px.y}
      width={px.w}
      text={cfg.text}
      fontFamily={style.fontFamily}
      fontSize={relToPixel(style.fontSize, CANVAS)}
      fontStyle={style.bold ? 'bold' : 'normal'}
      fill={style.color}
      stroke={style.strokeColor}
      strokeWidth={relToPixel(style.strokeWidth, CANVAS)}
      shadowEnabled={style.glowEnabled}
      shadowColor={style.glowColor}
      shadowBlur={relToPixel(style.glowBlur, CANVAS)}
      shadowOpacity={1}
      align={style.align}
      listening={false}
    />
  )
}

/** 主图层：Group 承载拖拽 + 等比缩放手柄；图片按 fillMode 填充 */
function MainImageLayer({
  layout,
  coverElement,
  selectedId,
  onSelect,
  onMainRectChange
}: SceneLayersProps): React.JSX.Element {
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const px = normToPixel(layout.mainImage.rect, CANVAS)
  const fillMode = layout.mainImage.fillMode

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selectedId === 'mainImage') {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selectedId, coverElement, fillMode])

  const commitFromGroup = (node: Konva.Group): void => {
    const rect = {
      x: node.x(),
      y: node.y(),
      w: node.width() * node.scaleX(),
      h: node.height() * node.scaleY()
    }
    onMainRectChange(pixelToNorm(rect, CANVAS))
  }

  let imageNode: React.JSX.Element | null = null
  if (coverElement) {
    const iw = coverElement.naturalWidth || coverElement.width
    const ih = coverElement.naturalHeight || coverElement.height
    if (iw > 0 && ih > 0) {
      if (fillMode === 'stretch') {
        imageNode = <KonvaImage image={coverElement} width={px.w} height={px.h} listening={false} />
      } else {
        const s =
          fillMode === 'contain' ? Math.min(px.w / iw, px.h / ih) : Math.max(px.w / iw, px.h / ih)
        const dw = iw * s
        const dh = ih * s
        imageNode = (
          <KonvaImage
            image={coverElement}
            x={(px.w - dw) / 2}
            y={(px.h - dh) / 2}
            width={dw}
            height={dh}
            listening={false}
          />
        )
      }
    }
  }

  const isCover = fillMode === 'cover'

  return (
    <>
      <Group
        ref={groupRef}
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        draggable
        onClick={() => onSelect('mainImage')}
        onTap={() => onSelect('mainImage')}
        onDragStart={() => onSelect('mainImage')}
        onDragEnd={(e: KonvaEventObject<DragEvent>) => commitFromGroup(e.target as Konva.Group)}
        onTransformEnd={(e: KonvaEventObject<Event>) => {
          const node = e.target as Konva.Group
          const sx = node.scaleX()
          const sy = node.scaleY()
          node.scale({ x: 1, y: 1 })
          node.width(node.width() * sx)
          node.height(node.height() * sy)
          commitFromGroup(node)
        }}
        dragBoundFunc={(pos) => {
          const node = groupRef.current
          if (!node) return pos
          const w = node.width() * node.scaleX()
          const h = node.height() * node.scaleY()
          return {
            x: Math.min(Math.max(pos.x, 0), LOGICAL_WIDTH - w),
            y: Math.min(Math.max(pos.y, 0), LOGICAL_HEIGHT - h)
          }
        }}
        clipX={isCover ? 0 : undefined}
        clipY={isCover ? 0 : undefined}
        clipWidth={isCover ? px.w : undefined}
        clipHeight={isCover ? px.h : undefined}
      >
        {/* 透明命中区：让整个矩形（含透明留白）都可拖动/选中 */}
        <Rect width={px.w} height={px.h} fill="rgba(0,0,0,0.01)" />
        {imageNode ?? (
          <>
            <Rect
              width={px.w}
              height={px.h}
              stroke="#5a5f6a"
              strokeWidth={2}
              dash={[12, 8]}
              cornerRadius={10}
              listening={false}
            />
            <KonvaText
              text="拖入封面图"
              x={0}
              y={px.h / 2 - 26}
              width={px.w}
              fontSize={44}
              fill="#7a808d"
              align="center"
              listening={false}
            />
          </>
        )}
      </Group>
      {selectedId === 'mainImage' && coverElement && (
        <Transformer
          ref={trRef}
          keepRatio
          rotateEnabled={false}
          borderStroke="#ff5f9e"
          anchorStroke="#ff5f9e"
          anchorFill="#ffffff"
          anchorSize={12}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 60 || newBox.height < 60) return oldBox
            if (
              newBox.x < 0 ||
              newBox.y < 0 ||
              newBox.x + newBox.width > LOGICAL_WIDTH ||
              newBox.y + newBox.height > LOGICAL_HEIGHT
            ) {
              return oldBox
            }
            return newBox
          }}
        />
      )}
    </>
  )
}

/** 可视化层：M2 为静态占位柱，M3 接入真实频谱数据 */
function VisualizerLayer({ config }: { config: VisualizerConfig }): React.JSX.Element {
  const px = normToPixel(config.rect, CANVAS)
  const bars = placeholderBars(config.barCount)
  const slot = px.w / config.barCount
  const barW = slot * config.barWidthRatio
  const maxH = px.h * config.heightRatio
  const baseY = px.y + px.h
  return (
    <Group>
      {bars.map((v, i) => {
        const h = Math.max(4, v * maxH)
        const x = px.x + i * slot + (slot - barW) / 2
        return (
          <Rect
            key={i}
            x={x}
            y={baseY - h}
            width={barW}
            height={h}
            fill={colorAt(config.colors, i / Math.max(1, config.barCount - 1))}
            cornerRadius={config.roundness}
            listening={false}
          />
        )
      })}
    </Group>
  )
}

/** 四层场景（从下到上）：背景 → 主图 → 文本 → 可视化。预览与导出共用本组件。 */
export function SceneLayers(props: SceneLayersProps): React.JSX.Element {
  const { layout, coverElement, selectedId, onSelect, onMainRectChange } = props
  return (
    <>
      <Layer name="background" listening={false}>
        <BackgroundLayer background={layout.background} coverElement={coverElement} />
      </Layer>
      <Layer name="main">
        <MainImageLayer
          layout={layout}
          coverElement={coverElement}
          selectedId={selectedId}
          onSelect={onSelect}
          onMainRectChange={onMainRectChange}
        />
      </Layer>
      <Layer name="text" listening={false}>
        <TextNode cfg={layout.texts.songTitle} />
        <TextNode cfg={layout.texts.artist} />
      </Layer>
      <Layer name="visualizer" listening={false}>
        <VisualizerLayer config={layout.visualizer} />
      </Layer>
    </>
  )
}
