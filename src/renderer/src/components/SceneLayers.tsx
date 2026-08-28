import { useEffect, useMemo, useRef } from 'react'
import {
  Group,
  Image as KonvaImage,
  Layer,
  Line as KonvaLine,
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
  relToPixel,
  type CanvasSize
} from '@shared/layout'
import { colorAt } from '@shared/color'
import { barGeometry } from '@shared/fx'
import { useLocale } from '../hooks/useLocale'

/** 可选中元素：主图 / 歌名 / 作者 / 可视化 */
export type SelectableId = 'mainImage' | 'songTitle' | 'artist' | 'visualizer' | null

export type SceneLayerName = 'background' | 'main' | 'text' | 'visualizer'

export interface SceneLayersProps {
  layout: ProjectLayout
  coverElement: HTMLImageElement | null
  /** 独立背景图（用户额外上传）；null 时按 imageSource 回退封面图 */
  bgElement: HTMLImageElement | null
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
  onTextRectChange: (kind: 'songTitle' | 'artist', rect: NormRect) => void
  onVisualizerRectChange: (rect: NormRect) => void
  /** 可视化柱高数组（0–1），长度 = layout.visualizer.barCount */
  bars: number[]
  /** 渲染画布尺寸：预览 = 1920×1080 逻辑，导出 = 目标分辨率（核心约束 B） */
  canvasSize?: CanvasSize
  /** 只渲染指定图层（导出拆分静态/动态用）；缺省 = 全部 */
  layers?: SceneLayerName[]
  /** 导出专用：命令式更新频谱柱（绕过 React 每帧渲染，绘制代码仍是本组件） */
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
}

const SELECT_BORDER = '#ff5f9e'

/**
 * 拖动边界：自由移动（元素可部分超出画布，所见即所得），
 * 只保证至少 60px 可见，避免完全拖丢（尤其元素接近/超过画布大小时）。
 */
function clampPos(
  pos: { x: number; y: number },
  w: number,
  h: number,
  canvas: CanvasSize
): { x: number; y: number } {
  const MIN_VISIBLE = 60
  return {
    x: Math.min(Math.max(pos.x, -(w - MIN_VISIBLE)), canvas.width - MIN_VISIBLE),
    y: Math.min(Math.max(pos.y, -(h - MIN_VISIBLE)), canvas.height - MIN_VISIBLE)
  }
}

/** 背景层：背景色（透明图合成基底）+ 封面铺满 + 高斯模糊 + 压暗遮罩 */
function BackgroundLayer({
  background,
  coverElement,
  bgElement,
  canvas
}: {
  background: ProjectLayout['background']
  coverElement: HTMLImageElement | null
  bgElement: HTMLImageElement | null
  canvas: CanvasSize
}): React.JSX.Element {
  const bgRef = useRef<Konva.Group>(null)
  /** 半分辨率缓存：模糊是低频效果，0.5 倍像素比视觉几乎无差、性能约 4 倍（模糊半径同步缩放） */
  const CACHE_RATIO = 0.5
  const blurRadius = (background.blur / 100) * 60 * CACHE_RATIO
  const showBlur = background.blur > 0

  // 图片来源：自定义（用户额外上传）优先，否则封面图
  const sourceImage = background.imageSource === 'custom' && bgElement ? bgElement : coverElement

  // 背景专用半分辨率画布副本：Konva 缓存会污染共享图片元素的纹理（主图会被画成背景缓存内容），
  // 因此背景永远使用自己的私有副本，主图继续用原始图片（性能与正确性兼得）
  const bgSource = useMemo(() => {
    if (!sourceImage) return null
    const iw = sourceImage.naturalWidth || sourceImage.width
    const ih = sourceImage.naturalHeight || sourceImage.height
    if (iw === 0 || ih === 0) return null
    const c = document.createElement('canvas')
    c.width = Math.max(1, Math.round(iw * 0.5))
    c.height = Math.max(1, Math.round(ih * 0.5))
    const ctx = c.getContext('2d')
    if (ctx) ctx.drawImage(sourceImage, 0, 0, c.width, c.height)
    return c
  }, [sourceImage])

  let cover: React.JSX.Element | null = null
  if (background.useImage && bgSource) {
    const iw = bgSource.width
    const ih = bgSource.height
    if (iw > 0 && ih > 0) {
      const s = Math.max(canvas.width / iw, canvas.height / ih)
      cover = (
        <KonvaImage
          image={bgSource}
          x={(canvas.width - iw * s) / 2}
          y={(canvas.height - ih * s) / 2}
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
      node.cache({ pixelRatio: CACHE_RATIO })
      node.getLayer()?.batchDraw()
    }
  }, [
    background.useImage,
    background.color,
    background.blur,
    bgSource,
    canvas.width,
    canvas.height
  ])

  return (
    <>
      <Group ref={bgRef} filters={showBlur ? [Blur] : []} blurRadius={blurRadius}>
        <Rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          fill={background.color}
          listening={false}
        />
        {cover}
      </Group>
      {background.dimOpacity > 0 && (
        <Rect
          x={0}
          y={0}
          width={canvas.width}
          height={canvas.height}
          fill="#000000"
          opacity={background.dimOpacity}
          listening={false}
        />
      )}
    </>
  )
}

/** 文本层：歌曲名/作者——可拖动、可缩放文本框（字号不变，宽度驱动自动换行；选中显示虚线框） */
function TextNode({
  kind,
  cfg,
  canvas,
  selected,
  onSelect,
  onRectChange
}: {
  kind: 'songTitle' | 'artist'
  cfg: TextLayerConfig
  canvas: CanvasSize
  selected: boolean
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
}): React.JSX.Element {
  const groupRef = useRef<Konva.Group>(null)
  const textRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const px = normToPixel(cfg.rect, canvas)
  const { style } = cfg

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selected) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selected, cfg.rect])

  const commit = (node: Konva.Group): void => {
    onRectChange(
      pixelToNorm({ x: node.x(), y: node.y(), w: node.width(), h: node.height() }, canvas)
    )
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        draggable
        onClick={() => onSelect(kind)}
        onTap={() => onSelect(kind)}
        onDragStart={() => onSelect(kind)}
        onDragEnd={(e: KonvaEventObject<DragEvent>) => commit(e.target as Konva.Group)}
        onTransform={() => {
          // 文本框缩放：字号保持不变，宽度实时重排文字
          const node = groupRef.current
          const tNode = textRef.current
          if (!node || !tNode) return
          const newW = Math.max(60, node.width() * node.scaleX())
          const newH = Math.max(20, node.height() * node.scaleY())
          node.scale({ x: 1, y: 1 })
          node.width(newW)
          node.height(newH)
          if (Math.abs(tNode.width() - newW) > 0.5) tNode.width(newW)
        }}
        onTransformEnd={(e: KonvaEventObject<Event>) => commit(e.target as Konva.Group)}
        dragBoundFunc={(pos) => {
          const node = groupRef.current
          if (!node) return pos
          return clampPos(pos, node.width(), node.height(), canvas)
        }}
      >
        {/* 透明命中区：让整个文本框区域都可点击选中/拖动 */}
        <Rect width={px.w} height={px.h} fill="rgba(0,0,0,0.01)" />
        {selected && (
          <Rect
            width={px.w}
            height={px.h}
            stroke={SELECT_BORDER}
            strokeWidth={1}
            dash={[6, 4]}
            listening={false}
          />
        )}
        <KonvaText
          ref={textRef}
          x={0}
          y={0}
          width={px.w}
          text={cfg.text}
          wrap="word"
          fontFamily={style.fontFamily}
          fontSize={relToPixel(style.fontSize, canvas)}
          fontStyle={style.bold ? 'bold' : 'normal'}
          fill={style.color}
          stroke={style.strokeColor}
          strokeWidth={relToPixel(style.strokeWidth, canvas)}
          shadowEnabled={style.glowEnabled}
          shadowColor={style.glowColor}
          shadowBlur={relToPixel(style.glowBlur, canvas)}
          shadowOpacity={1}
          align={style.align}
          listening={false}
        />
      </Group>
      {selected && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          keepRatio={false}
          borderStroke={SELECT_BORDER}
          anchorStroke={SELECT_BORDER}
          anchorFill="#ffffff"
          anchorSize={10}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 60 || newBox.height < 20) return oldBox
            return newBox
          }}
        />
      )}
    </>
  )
}
interface MainImageLayerProps {
  layout: ProjectLayout
  coverElement: HTMLImageElement | null
  canvas: CanvasSize
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
}

/** 主图层：Group 承载拖拽 + 等比缩放手柄；图片按 fillMode 填充 */
function MainImageLayer({
  layout,
  coverElement,
  canvas,
  selectedId,
  onSelect,
  onMainRectChange
}: MainImageLayerProps): React.JSX.Element {
  const { t } = useLocale()
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const px = normToPixel(layout.mainImage.rect, canvas)
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
    onMainRectChange(pixelToNorm(rect, canvas))
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
          return clampPos(pos, node.width() * node.scaleX(), node.height() * node.scaleY(), canvas)
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
              text={t('canvas.dropCoverPlaceholder')}
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
          borderStroke={SELECT_BORDER}
          anchorStroke={SELECT_BORDER}
          anchorFill="#ffffff"
          anchorSize={12}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 60 || newBox.height < 60) return oldBox
            if (
              newBox.x < 0 ||
              newBox.y < 0 ||
              newBox.x + newBox.width > canvas.width ||
              newBox.y + newBox.height > canvas.height
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

interface VisualizerLayerProps {
  config: VisualizerConfig
  /** 0–1 柱高数组（长度 = barCount）；预览=实时频谱，导出=逐帧频谱 */
  bars: number[]
  canvas: CanvasSize
  selected: boolean
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
}

/** 可视化层：可拖动选择位置；支持命令式逐帧更新（导出）。
 * 形态：bars（默认，旧几何）/ mirror / center / radial / wave / area / dots。
 * 所有形态共享同一 bars[] 数据与同一命令式更新通道（核心约束 A）。 */
function VisualizerLayer({
  config,
  bars,
  canvas,
  selected,
  onSelect,
  onRectChange,
  barsHandleRef
}: VisualizerLayerProps): React.JSX.Element {
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const barNodes = useRef<(Konva.Rect | null)[]>([])
  const waveRef = useRef<Konva.Line | null>(null)
  const px = normToPixel(config.rect, canvas)
  const slot = px.w / config.barCount
  const maxH = px.h * config.heightRatio
  const baseY = px.h
  const style = config.style

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selected) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selected, config.rect, style])

  // 命令式更新（预览 rAF 与导出逐帧共用同一函数；几何由 fx.barGeometry 纯函数给出）
  useEffect(() => {
    if (!barsHandleRef) return
    barsHandleRef.current = (next: number[]) => {
      const g = groupRef.current?.getLayer()
      if (style === 'wave') {
        const line = waveRef.current
        if (line) {
          const pts: number[] = []
          for (let i = 0; i < next.length; i++) {
            const v = Math.min(Math.max(next[i] ?? 0, 0), 1)
            pts.push(i * slot, baseY - Math.max(4, v * maxH))
          }
          line.points(pts)
          line.getLayer()?.batchDraw()
        }
        return
      }
      barNodes.current.forEach((node, i) => {
        if (!node) return
        const gGeo = barGeometry(
          style,
          i,
          next[i] ?? 0,
          config.barCount,
          px.w,
          px.h,
          config.barWidthRatio,
          config.gapRatio,
          config.heightRatio
        )
        node.x(gGeo.x)
        node.y(gGeo.y)
        node.width(gGeo.w)
        node.height(gGeo.h)
        node.rotation(gGeo.rotation)
      })
      g?.batchDraw()
    }
    return () => {
      barsHandleRef.current = null
    }
  }, [
    barsHandleRef,
    style,
    config.rect,
    config.barCount,
    config.barWidthRatio,
    config.gapRatio,
    config.heightRatio,
    px.w,
    px.h,
    maxH,
    baseY,
    slot
  ])

  const isWave = style === 'wave'
  // 渲染期几何（仅 bars 形态为"旧代码路径"：x/y/w/h 与 0.3.0 完全一致，保证默认基线不变）
  const renderBar = (i: number): React.JSX.Element | null => {
    const v = Math.min(Math.max(bars[i] ?? 0, 0), 1)
    if (isWave) return null
    const gGeo = barGeometry(
      style,
      i,
      v,
      config.barCount,
      px.w,
      px.h,
      config.barWidthRatio,
      config.gapRatio,
      config.heightRatio
    )
    return (
      <Rect
        key={i}
        ref={(el) => {
          barNodes.current[i] = el
        }}
        x={gGeo.x}
        y={gGeo.y}
        width={gGeo.w}
        height={gGeo.h}
        rotation={gGeo.rotation}
        fill={colorAt(config.colors, i / Math.max(1, config.barCount - 1))}
        cornerRadius={style === 'bars' ? config.roundness : 0}
        listening={false}
      />
    )
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        draggable
        onClick={() => onSelect('visualizer')}
        onTap={() => onSelect('visualizer')}
        onDragStart={() => onSelect('visualizer')}
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          const node = e.target as Konva.Group
          onRectChange(pixelToNorm({ x: node.x(), y: node.y(), w: px.w, h: px.h }, canvas))
        }}
        dragBoundFunc={(pos) => {
          const node = groupRef.current
          if (!node) return pos
          return clampPos(pos, node.width(), node.height(), canvas)
        }}
      >
        {/* 透明命中区：整个矩形（含柱子间空隙）都可拖动/选中 */}
        <Rect width={px.w} height={px.h} fill="rgba(0,0,0,0.01)" />
        {isWave ? (
          <KonvaLine
            ref={waveRef}
            points={[0, baseY]}
            stroke={config.colors[0] ?? '#ff5f9e'}
            strokeWidth={3}
            lineCap="round"
            lineJoin="round"
            listening={false}
          />
        ) : (
          Array.from({ length: config.barCount }, (_, i) => renderBar(i))
        )}
      </Group>
      {selected && (
        <Transformer
          ref={trRef}
          enabledAnchors={[]}
          rotateEnabled={false}
          resizeEnabled={false}
          borderStroke={SELECT_BORDER}
          borderDash={[6, 4]}
        />
      )}
    </>
  )
}

/** 四层场景（从下到上）：背景 → 主图 → 文本 → 可视化。预览与导出共用本组件。 */
export function SceneLayers(props: SceneLayersProps): React.JSX.Element {
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
    canvasSize,
    layers,
    barsHandleRef
  } = props
  const canvas = canvasSize ?? { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }
  const show = (name: SceneLayerName): boolean => !layers || layers.includes(name)
  return (
    <>
      {show('background') && (
        <Layer name="background" listening={false}>
          <BackgroundLayer
            background={layout.background}
            coverElement={coverElement}
            bgElement={bgElement}
            canvas={canvas}
          />
        </Layer>
      )}
      {show('main') && (
        <Layer name="main">
          <MainImageLayer
            layout={layout}
            coverElement={coverElement}
            canvas={canvas}
            selectedId={selectedId}
            onSelect={onSelect}
            onMainRectChange={onMainRectChange}
          />
        </Layer>
      )}
      {show('text') && (
        <Layer name="text">
          <TextNode
            kind="songTitle"
            cfg={layout.texts.songTitle}
            canvas={canvas}
            selected={selectedId === 'songTitle'}
            onSelect={onSelect}
            onRectChange={(rect) => onTextRectChange('songTitle', rect)}
          />
          <TextNode
            kind="artist"
            cfg={layout.texts.artist}
            canvas={canvas}
            selected={selectedId === 'artist'}
            onSelect={onSelect}
            onRectChange={(rect) => onTextRectChange('artist', rect)}
          />
        </Layer>
      )}
      {show('visualizer') && (
        <Layer name="visualizer">
          <VisualizerLayer
            config={layout.visualizer}
            bars={bars}
            canvas={canvas}
            selected={selectedId === 'visualizer'}
            onSelect={onSelect}
            onRectChange={onVisualizerRectChange}
            barsHandleRef={barsHandleRef}
          />
        </Layer>
      )}
    </>
  )
}
