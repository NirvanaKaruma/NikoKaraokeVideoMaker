import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Circle,
  Group,
  Image as KonvaImage,
  Line as SnapLineNode,
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
  type CanvasSize,
  type ImageFxConfig,
  type MainImageConfig,
  type OverlayEntryConfig,
  type OverlayLayerConfig,
  type PixelRect
} from '@shared/layout'
import { defaultLayerOrder } from '@shared/layout'
import { colorAt } from '@shared/color'
import {
  bandEnergySmoothed,
  barGeometry,
  beatEnvelope,
  beatEnvelopeCurve,
  beatPeriod,
  bounceIn,
  easeOutCubic,
  entryProgress,
  introOutroAlpha,
  kenBurns,
  lineHeights,
  wedgeGeometry,
  type BandEnergies
} from '@shared/fx'
import { bandEnergiesAt, type SpectrumAnalyzer } from '@shared/spectrum'
import { beatTimeAt } from '@shared/timeline'
import { snapPosition, type SnapLine, type SnapRect } from '@shared/snap'
import { useLocale } from '../hooks/useLocale'
import type { CanvasImageElement } from '../hooks/useProject'

/** 背景动效种子（确定性；Ken Burns 随时间推进） */
const SEED_BG_FX = 987654321

/** 可选中元素：主图 / 歌名 / 作者 / 可视化 / 附加层（overlay:<id>）/ 自定义文本（text:<id>） */
export type SelectableId =
  | 'mainImage'
  | 'songTitle'
  | 'artist'
  | 'visualizer'
  | `overlay:${string}`
  | `text:${string}`
  | null

export type SceneLayerName =
  | 'background'
  | 'main'
  | 'overlay'
  | 'songTitle'
  | 'artist'
  | 'text'
  | 'visualizer'
  | 'fx'
  | 'snap-guides'

/** 吸附上下文（0.9.0）：拖动中读取目标集与开关，写回引导线 */
export interface SnapCtx {
  enabled: boolean
  targets: SnapRect[]
  setGuides: (lines: SnapLine[]) => void
}

/** 拖动中吸附（0.9.0）：位置按阈值对齐目标线 + 画线；关/无命中保持原位 */
function snapDragNode(node: Konva.Group, ctx: SnapCtx | null, canvas: CanvasSize): void {
  if (!ctx) return
  const pos = node.position()
  const w = node.width() * node.scaleX()
  const h = node.height() * node.scaleY()
  const move: SnapRect = { x: pos.x, y: pos.y, w, h }
  const r = ctx.enabled
    ? snapPosition(move, ctx.targets, { width: canvas.width, height: canvas.height })
    : { x: pos.x, y: pos.y, lines: [] }
  node.position({ x: r.x, y: r.y })
  ctx.setGuides(r.lines)
}

/** 图像源尺寸（Image 用 naturalWidth，Canvas 用 width） */
function imgW(el: CanvasImageElement): number {
  return (el as HTMLImageElement).naturalWidth || el.width
}
function imgH(el: CanvasImageElement): number {
  return (el as HTMLImageElement).naturalHeight || el.height
}

export interface SceneLayersProps {
  layout: ProjectLayout
  coverElement: CanvasImageElement | null
  /** 独立背景图（用户额外上传）；null 时按 imageSource 回退封面图 */
  bgElement: CanvasImageElement | null
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
  onTextRectChange: (kind: 'songTitle' | 'artist', rect: NormRect) => void
  /** 1.1.1 自定义文本框：拖动/缩放矩形变更（id → rect） */
  onExtraTextRectChange?: (id: string, rect: NormRect) => void
  onVisualizerRectChange: (rect: NormRect) => void
  /** 可视化柱高数组（0–1），长度 = layout.visualizer.barCount */
  bars: number[]
  /** 渲染画布尺寸：预览 = 1920×1080 逻辑，导出 = 目标分辨率（核心约束 B） */
  canvasSize?: CanvasSize
  /** 只渲染指定图层（导出拆分静态/动态用）；缺省 = 全部 */
  layers?: SceneLayerName[]
  /** 导出专用：命令式更新频谱柱（绕过 React 每帧渲染，绘制代码仍是本组件） */
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
  /** 动效帧时间（秒）：命令式更新随时间变化的元素（flow 相位等） */
  frameTRef?: { current: ((t: number) => void) | null }
  /** 共享频谱分析器（动效层按时间 t 计算分带能量；预览/导出同一数据源） */
  analyzer?: SpectrumAnalyzer | null
  /** 非可视化动效帧分发（背景/主图/文本/片头片尾每帧更新；预览 rAF 与导出逐帧同源）。
   * 第二参 audioT = 音频时间轴（0.7.0 导出 lead>0 时 ≠ t；预览缺省 = t）。 */
  layerFxRef?: { current: ((t: number, audioT?: number) => void) | null }
  /** 前导留白秒（0.7.0）：片头黑场/标题卡时间轴用（预览/导出同传——所见即所得） */
  audioLeadSec?: number
  /** 音频总时长秒（片尾时间轴用） */
  mediaDurationSec?: number
  /** 附加层图像元素（0.8.0）：layerId → 解码后元素（layout.overlayLayers 平行） */
  overlayElements?: Record<string, CanvasImageElement | null>
  /** 附加层矩形变化（0.8.0，拖动/缩放提交） */
  onOverlayRectChange?: (id: string, rect: NormRect) => void
  /** 变 BPM 蓄积拍数（节拍相位跨段变速连续；缺省按本布局推导） */
  beatsAt?: ((t: number) => number) | null
}

const SELECT_BORDER = '#ff5f9e'

/** 五角星顶点（中心锚定 0,0；外径 R、内径 r） */
function starPoints(R: number, r: number, n = 5): number[] {
  const pts: number[] = []
  for (let i = 0; i < n * 2; i++) {
    const rad = i % 2 === 0 ? R : r
    const a = (Math.PI * i) / n - Math.PI / 2
    pts.push(Math.cos(a) * rad, Math.sin(a) * rad)
  }
  return pts
}

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

/** 背景层：背景色（透明图合成基底）+ 封面铺满 + 高斯模糊 + 压暗遮罩（0.5.0：Ken Burns + bass 呼吸）。
 * 动效走命令式每帧更新（layerFxSlot）：Ken Burns 应用于缓存组变换（不触发重缓存），
 * 呼吸用组外叠色 Rect（仅改 opacity，廉价且预览/导出同源）。 */
function BackgroundLayer({
  layout,
  coverElement,
  bgElement,
  analyzer,
  canvas,
  layerFxSlotRef,
  beatsAt
}: {
  layout: ProjectLayout
  coverElement: CanvasImageElement | null
  bgElement: CanvasImageElement | null
  /** 共享频谱分析器（0.5.0：bass 呼吸等按 t 采样） */
  analyzer?: SpectrumAnalyzer | null
  canvas: CanvasSize
  /** 每帧动效更新槽（SceneLayers 分发 frame(t, audioT)）；命名以 Ref 结尾（react-hooks 规范） */
  layerFxSlotRef?: { current: ((t: number, audioT: number) => void) | null }
  /** 变 BPM 蓄积拍数（可选） */
  beatsAt?: ((t: number) => number) | null
}): React.JSX.Element {
  const background = layout.background
  const bgRef = useRef<Konva.Group>(null)
  const breatheBrightRef = useRef<Konva.Rect>(null)
  const breatheHueRef = useRef<Konva.Rect>(null)
  /** 半分辨率缓存：模糊是低频效果，0.5 倍像素比视觉几乎无差、性能约 4 倍（模糊半径同步缩放） */
  const CACHE_RATIO = 0.5
  const blurRadius = (background.blur / 100) * 60 * CACHE_RATIO
  const showBlur = background.blur > 0
  /**
   * filters 数组必须 useMemo：Konva setter（filters/blurRadius）每次调用都会置
   * _filterUpToDate=false → 下帧 drawScene 重滤（getImageData/putImageData 全缓存像素）。
   * 导出期间 App 每帧 setState → 本组件每帧重渲染 → 若直接传 [Blur] 每帧重建数组 → react-konva
   * 每帧重设 filters → 每帧全量重滤（1080p 35ms/4K 120ms——P1a 逐层计量定位）。固定身份即一次缓存。
   */
  const blurFilters = useMemo(() => (showBlur ? [Blur] : []), [showBlur])
  const blurRadiusMemo = useMemo(() => blurRadius, [blurRadius])

  // 图片来源：自定义（用户额外上传）优先，否则封面图
  const sourceImage = background.imageSource === 'custom' && bgElement ? bgElement : coverElement

  // 背景专用半分辨率画布副本：Konva 缓存会污染共享图片元素的纹理（主图会被画成背景缓存内容），
  // 因此背景永远使用自己的私有副本，主图继续用原始图片（性能与正确性兼得）
  const bgSource = useMemo(() => {
    if (!sourceImage) return null
    const iw = imgW(sourceImage)
    const ih = imgH(sourceImage)
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

  // 每帧动效：Ken Burns（缓存组变换，中心锚定、无露边）+ bass 呼吸（brightness/hue 叠色 opacity）
  useEffect(() => {
    if (!layerFxSlotRef) return
    layerFxSlotRef.current = (t: number, audioT: number): void => {
      const g = bgRef.current
      const offsetVis = layout.visualizer.offsetMs / 1000
      const sample = (tt: number): BandEnergies =>
        bandEnergiesAt(
          analyzer!,
          tt + offsetVis,
          layout.visualizer.barCount,
          layout.visualizer.sensitivity
        )
      const tVis = t + offsetVis // Ken Burns 等连续运镜：wall 轴（前导期间不冻结）
      const aVis = audioT + offsetVis // bass 呼吸/踩点脉冲：音频驱动 → 音频轴 + 偏移
      // Ken Burns：仅在启用时施加变换；关闭时复位（防切开关后残留）
      if (background.fx.kenBurns > 0 && g) {
        const [s, dx, dy] = kenBurns(
          tVis,
          SEED_BG_FX,
          Math.max(1, background.fx.kenBurnsDuration),
          background.fx.kenBurns * 0.35
        )
        g.scale({ x: s, y: s })
        g.x((canvas.width - canvas.width * s) / 2 + dx * canvas.width)
        g.y((canvas.height - canvas.height * s) / 2 + dy * canvas.height)
      } else if (g && g.scaleX() !== 1) {
        g.scale({ x: 1, y: 1 })
        g.x(0)
        g.y(0)
      }
      // bass 呼吸：0–0.4s 窗口平滑（灯光随低音起伏）+ 手动节拍脉冲（beat 起点短闪）。
      // 呼吸未启用时跳过窗口采样（省 5×FFT/帧——曾导致播放中持续卡顿/GC 尖刺）
      const wantBreath = background.fx.bassBrightness > 0 || background.fx.bassHue > 0
      const bassV = wantBreath && analyzer ? bandEnergySmoothed(sample, aVis, 'bass', 0.4) : 0
      const period = beatPeriod(layout.visualizer.bpm, layout.visualizer.beatIntervalSec)
      const env =
        period != null
          ? beatsAt
            ? beatEnvelopeCurve(aVis, period, 0.18, beatsAt)
            : beatEnvelope(aVis, period)
          : 0
      const bright = breatheBrightRef.current
      if (bright) {
        const bv = Math.min(
          1,
          bassV * background.fx.bassBrightness * 1.4 + env * layout.beat.pulse * 0.55
        )
        bright.opacity(bv)
        // opacity≈0 时隐藏跳过全屏 fill（软件光栅化下每帧 ≤4 次全屏 fill 是背景层主成本）
        bright.visible(bv > 0.001)
      }
      const hue = breatheHueRef.current
      if (hue) {
        const hv = Math.min(0.7, bassV * background.fx.bassHue * 0.7)
        hue.opacity(hv)
        hue.visible(hv > 0.001)
      }
      g?.getLayer()?.batchDraw()
    }
    return () => {
      layerFxSlotRef.current = null
    }
  }, [
    layerFxSlotRef,
    layout,
    analyzer,
    canvas.width,
    canvas.height,
    beatsAt,
    background.fx.kenBurns,
    background.fx.kenBurnsDuration,
    background.fx.bassBrightness,
    background.fx.bassHue
  ])

  return (
    <>
      <Group ref={bgRef} filters={blurFilters} blurRadius={blurRadiusMemo}>
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
      <Rect
        ref={breatheBrightRef}
        name="bg-pulse"
        x={0}
        y={0}
        width={canvas.width}
        height={canvas.height}
        fill="#ffffff"
        opacity={0}
        listening={false}
      />
      <Rect
        ref={breatheHueRef}
        x={0}
        y={0}
        width={canvas.width}
        height={canvas.height}
        fill="#ff8a3d"
        globalCompositeOperation="hue"
        opacity={0}
        listening={false}
      />
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

/** 片头/片尾层（0.5.0）：黑场淡入/淡出 + 标题卡（复用歌名/作者样式居中）。
 * 时间函数纯确定性（introOutroAlpha）；由 fxSlot 逐帧驱动（预览/导出同源）。 */
function IntroOutroLayer({
  layout,
  canvas,
  mediaDurationSec,
  leadSec,
  fxSlotRef
}: {
  layout: ProjectLayout
  canvas: CanvasSize
  /** 音频总时长秒（片尾时间轴用；无音频=0 → 片尾不生效） */
  mediaDurationSec?: number
  /** 前导留白秒（0.7.0，仅导出侧）：总轴 = 音频轴 + leadSec */
  leadSec?: number
  /** 每帧更新槽（SceneLayers 分发 frame(t, audioT)） */
  fxSlotRef?: { current: ((t: number, audioT: number) => void) | null }
}): React.JSX.Element {
  const blackRef = useRef<Konva.Rect>(null)
  const tcGroupRef = useRef<Konva.Group>(null)

  useEffect(() => {
    if (!fxSlotRef) return
    fxSlotRef.current = (t: number): void => {
      const a = introOutroAlpha(t, mediaDurationSec ?? 0, layout.introOutro, leadSec ?? 0)
      const black = blackRef.current
      if (black) {
        const opacity = Math.min(1, Math.max(a.intro, a.outro))
        if (Math.abs(black.opacity() - opacity) > 0.001) black.opacity(opacity)
      }
      const tc = tcGroupRef.current
      if (tc) {
        if (Math.abs(tc.opacity() - a.titleCard) > 0.001) tc.opacity(a.titleCard)
      }
      ;(black ?? tc)?.getLayer()?.batchDraw()
    }
    return () => {
      fxSlotRef.current = null
    }
  }, [fxSlotRef, layout.introOutro, mediaDurationSec, leadSec])

  const title = layout.texts.songTitle
  const artist = layout.texts.artist
  const tcW = canvas.width * 0.72
  const tcX = (canvas.width - tcW) / 2
  const titleStyle = title.style
  const artistStyle = artist.style

  return (
    <>
      <Rect
        ref={blackRef}
        name="fx-black"
        x={0}
        y={0}
        width={canvas.width}
        height={canvas.height}
        fill="#000000"
        opacity={0}
        listening={false}
      />
      <Group ref={tcGroupRef} opacity={0} listening={false}>
        <KonvaText
          text={title.text}
          x={tcX}
          y={canvas.height * 0.34}
          width={tcW}
          align="center"
          wrap="word"
          fontFamily={titleStyle.fontFamily}
          fontSize={relToPixel(titleStyle.fontSize * 1.7, canvas)}
          fontStyle={titleStyle.bold ? 'bold' : 'normal'}
          fill={titleStyle.color}
          stroke={titleStyle.strokeColor}
          strokeWidth={relToPixel(titleStyle.strokeWidth, canvas)}
          shadowEnabled={titleStyle.glowEnabled}
          shadowColor={titleStyle.glowColor}
          shadowBlur={relToPixel(titleStyle.glowBlur, canvas)}
          shadowOpacity={1}
          listening={false}
        />
        <KonvaText
          text={artist.text}
          x={tcX}
          y={canvas.height * 0.56}
          width={tcW}
          align="center"
          wrap="word"
          fontFamily={artistStyle.fontFamily}
          fontSize={relToPixel(artistStyle.fontSize * 1.6, canvas)}
          fill={artistStyle.color}
          stroke={artistStyle.strokeColor}
          strokeWidth={relToPixel(artistStyle.strokeWidth, canvas)}
          shadowEnabled={artistStyle.glowEnabled}
          shadowColor={artistStyle.glowColor}
          shadowBlur={relToPixel(artistStyle.glowBlur, canvas)}
          shadowOpacity={1}
          listening={false}
        />
      </Group>
    </>
  )
}

/** 文本层：歌曲名/作者——可拖动、可缩放文本框（字号不变，宽度驱动自动换行；选中显示虚线框）。
 * 0.5.0：入场动画（fade/slide/typewriter/bounce）——作用于内部文字节点（不动可拖组），
 * 由 textFxSlot 逐帧驱动（时间轴语义：进入即生效，暂停/seek 同步，预览/导出同源）。 */
/**
 * 1.1.1 自定义文本框包装：持有 slot ref 对象，effect 注册/注销到父级 Map——
 * 渲染期不读任何 ref（react-hooks/refs），入场动画与歌名/作者同机制。
 */
function ExtraTextBox({
  tid,
  cfg,
  canvas,
  selected,
  locked,
  snapCtxRef,
  onSelect,
  onRectChange,
  textSlotsRef
}: {
  tid: string
  cfg: TextLayerConfig
  canvas: CanvasSize
  selected: boolean
  locked: boolean
  snapCtxRef?: { current: SnapCtx }
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
  textSlotsRef: React.MutableRefObject<Map<string, { current: ((t: number) => void) | null }>>
}): React.JSX.Element {
  // slotRef 为稳定裸 { current: fn } 对象（TextNode 直接消费；map 值 = 同一对象引用）
  const slotRef = useMemo(() => ({ current: null as ((t: number) => void) | null }), [])
  useEffect(() => {
    textSlotsRef.current.set(tid, slotRef)
    return () => {
      if (textSlotsRef.current.get(tid) === slotRef) {
        textSlotsRef.current.delete(tid)
      }
    }
  }, [tid, textSlotsRef, slotRef])
  return (
    <TextNode
      kind="songTitle"
      cfg={cfg}
      canvas={canvas}
      selected={selected}
      locked={locked}
      snapCtxRef={snapCtxRef}
      onSelect={onSelect}
      onRectChange={onRectChange}
      textFxSlotRef={slotRef}
    />
  )
}

function TextNode({
  kind,
  cfg,
  canvas,
  selected,
  locked,
  snapCtxRef,
  onSelect,
  onRectChange,
  textFxSlotRef
}: {
  kind: 'songTitle' | 'artist'
  cfg: TextLayerConfig
  canvas: CanvasSize
  selected: boolean
  /** 0.9.0 画布锁定 */
  locked?: boolean
  /** 0.9.0 吸附上下文 */
  snapCtxRef?: { current: SnapCtx }
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
  /** 每帧入场动画更新槽（SceneLayers 分发 frame(t)） */
  textFxSlotRef?: { current: ((t: number) => void) | null }
}): React.JSX.Element {
  const groupRef = useRef<Konva.Group>(null)
  const textRef = useRef<Konva.Text>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const px = normToPixel(cfg.rect, canvas)
  const { style } = cfg

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selected && !locked) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selected, locked, cfg.rect])

  // 入场动画逐帧应用：进度→按类型变换；完成后复位到最终态（防止残留半透明/位移/字符截断）
  useEffect(() => {
    if (!textFxSlotRef) return
    textFxSlotRef.current = (t: number): void => {
      const te = textRef.current
      if (!te) return
      const en = cfg.entry
      const p = entryProgress(t, en.delaySec, en.durationSec)
      const done = en.type === 'none' || p >= 1
      // 复位最终态（React 只给基准值 0/0/全文，命令式仅在此覆盖）
      if (done) {
        te.opacity(1)
        te.x(0)
        te.y(0)
        if (te.text() !== cfg.text) te.text(cfg.text)
        te.getLayer()?.batchDraw()
        return
      }
      const e = easeOutCubic(p)
      switch (en.type) {
        case 'fade':
          te.opacity(e)
          break
        case 'slide':
          te.opacity(Math.min(1, p * 1.5))
          te.x((1 - e) * px.w * 0.6)
          break
        case 'typewriter':
          te.opacity(1)
          te.text(cfg.text.slice(0, Math.max(1, Math.round(p * cfg.text.length))))
          break
        case 'bounce':
          te.opacity(Math.min(1, p * 2))
          te.y(-(1 - bounceIn(p)) * px.h * 0.45 + 6 * (1 - p))
          break
        default:
          break
      }
      te.getLayer()?.batchDraw()
    }
    return () => {
      textFxSlotRef.current = null
    }
  }, [textFxSlotRef, cfg.entry, cfg.text, px.w, px.h])

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
        draggable={!locked}
        onClick={() => {
          if (!locked) onSelect(kind)
        }}
        onTap={() => {
          if (!locked) onSelect(kind)
        }}
        onDragStart={() => {
          if (!locked) onSelect(kind)
        }}
        onDragMove={(e: KonvaEventObject<DragEvent>) =>
          snapDragNode(e.target as Konva.Group, snapCtxRef?.current ?? null, canvas)
        }
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          snapCtxRef?.current?.setGuides([])
          commit(e.target as Konva.Group)
        }}
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
      {selected && !locked && (
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
/** 共享图片动效内容（0.8.0 提取）：中心锚定图像（按 fillMode 落位）+ mask 裁剪 + 描边 + 整体透明度 +
 * 命令式动效槽（呼吸/微旋转/发光脉冲/手动节拍 kick——音频轴 audioT 驱动，默认全关）。
 * MainImageLayer 与附加层共用同一实现（核心约束 A：预览/导出同源渲染）。 */
function SharedImageFxLayer({
  imageElement,
  px,
  canvas,
  fillMode,
  fx,
  opacity,
  beatPulse,
  beatPeriodSec,
  beatsAt,
  entry,
  layerFxSlotRef
}: {
  imageElement: CanvasImageElement | null
  /** 归一化矩形换算后的像素矩形（外层 Group 坐标系；内容以 rect 中心锚定） */
  px: PixelRect
  canvas: CanvasSize
  fillMode: MainImageConfig['fillMode']
  fx: ImageFxConfig
  /** 整体不透明度 0–1（附加层用；主图恒 1） */
  opacity: number
  /** 手动节拍 kick 强度（layout.beat.pulse） */
  beatPulse: number
  /** 手动节拍周期秒（null=节拍关） */
  beatPeriodSec: number | null
  /** 变 BPM 蓄积拍数（可选：跨段变速节拍相位连续；缺省回退 beatEnvelope） */
  beatsAt?: ((t: number) => number) | null
  /** 入场动画（0.8.0 附加层专用：fade/slide/bounce；主图不传 = 无） */
  entry?: OverlayEntryConfig | null
  /** 每帧动效槽（SceneLayers 分发 frame(t, audioT)） */
  layerFxSlotRef?: { current: ((t: number, audioT: number) => void) | null }
}): React.JSX.Element {
  const fxGroupRef = useRef<Konva.Group>(null)
  const imgRef = useRef<Konva.Image>(null)

  // 图片（中心锚定：fxGroup 位于 rect 中心，图片以自身中心为原点，缩放/旋转绕中心）
  let imageNode: React.JSX.Element | null = null
  let dw = 0
  let dh = 0
  if (imageElement) {
    const iw = imgW(imageElement)
    const ih = imgH(imageElement)
    if (iw > 0 && ih > 0) {
      if (fillMode === 'stretch') {
        dw = px.w
        dh = px.h
        imageNode = (
          <KonvaImage
            ref={imgRef}
            image={imageElement}
            x={-px.w / 2}
            y={-px.h / 2}
            width={px.w}
            height={px.h}
            listening={false}
          />
        )
      } else {
        const s =
          fillMode === 'contain' ? Math.min(px.w / iw, px.h / ih) : Math.max(px.w / iw, px.h / ih)
        dw = iw * s
        dh = ih * s
        imageNode = (
          <KonvaImage
            ref={imgRef}
            image={imageElement}
            x={-dw / 2}
            y={-dh / 2}
            width={dw}
            height={dh}
            listening={false}
          />
        )
      }
    }
  }

  // 形状遮罩（React 静态驱动；随图像中心 0,0）：none=无 / circle=圆 / star=五角星
  const mR = Math.min(dw, dh) / 2
  const clipFn = (ctx: Konva.Context): void => {
    if (fx.mask === 'circle') {
      ctx.arc(0, 0, Math.max(1, mR), 0, Math.PI * 2)
    } else if (fx.mask === 'star') {
      const pts = starPoints(mR, mR * 0.4)
      ctx.moveTo(pts[0], pts[1])
      for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1])
    }
  }

  // 边框装饰（React 静态驱动；围绕遮罩形状描边；0=关）
  const borderW = fx.border > 0 ? Math.max(1, fx.border * canvas.height) : 0
  let borderNode: React.JSX.Element | null = null
  if (borderW > 0 && dw > 0 && dh > 0) {
    const stroke = { stroke: fx.borderColor, strokeWidth: borderW, listening: false }
    if (fx.mask === 'circle') {
      borderNode = <Circle x={0} y={0} radius={Math.max(1, mR)} {...stroke} />
    } else if (fx.mask === 'star') {
      borderNode = <KonvaLine points={starPoints(mR, mR * 0.4)} closed {...stroke} />
    } else {
      borderNode = (
        <Rect x={-dw / 2} y={-dh / 2} width={dw} height={dh} cornerRadius={borderW} {...stroke} />
      )
    }
  }

  // 每帧动效：呼吸缩放 + 微旋转 + 发光脉冲（shadowBlur 动画；默认全部关闭时复位）
  useEffect(() => {
    if (!layerFxSlotRef) return
    layerFxSlotRef.current = (tt: number, audioT: number): void => {
      const fg = fxGroupRef.current
      if (!fg) return
      const twoPi = Math.PI * 2
      // 呼吸：±强度×4% 缩放；周期 breathePeriod 秒
      const breatheS =
        fx.breathe > 0
          ? 1 +
            fx.breathe * 0.04 * (0.5 + 0.5 * Math.sin((twoPi * tt) / Math.max(1, fx.breathePeriod)))
          : 1
      // 微旋转：±rotateDeg° 慢速往复（16s 周期）
      const rotDeg = fx.rotateDeg > 0 ? fx.rotateDeg * Math.sin((twoPi * tt) / 16) : 0
      // 手动节拍 Kick 缩放（beat 起点微弹）——音频驱动 → 音频时间轴（前导期间无 kick）
      const env =
        beatPeriodSec != null
          ? beatsAt
            ? beatEnvelopeCurve(audioT, beatPeriodSec, 0.18, beatsAt)
            : beatEnvelope(audioT, beatPeriodSec)
          : 0
      const kick = env * beatPulse * 0.04
      fg.scale({ x: breatheS + kick, y: breatheS + kick })
      fg.rotation(rotDeg)
      // 发光脉冲：shadowBlur 0→强度×60px（2.4s 周期）；无脉冲时关阴影
      const glow =
        fx.glowPulse > 0 ? fx.glowPulse * 60 * (0.5 + 0.5 * Math.sin((twoPi * tt) / 2.4)) : 0
      // 发光载体=图片节点（Konva Group 运行时不支持 shadow；图片=Shape）。
      // 注意：mask≠none 时图像被裁剪组包住，辉光会被裁剪（组合场景较少见，先接受）。
      const img = imgRef.current
      if (img) {
        img.shadowColor('#ffffff')
        img.shadowBlur(glow)
        img.shadowOpacity(glow > 0 ? 0.75 : 0)
        img.shadowOffset({ x: 0, y: 0 })
      }
      // 入场动画（0.8.0 附加层）：fade/slide/bounce——语义同文本入场（确定性时间函数）；
      // 完成后复位最终态（opacity 基准 + 中心基准），防止残留半透明/位移
      if (entry && entry.type !== 'none') {
        const p = entryProgress(tt, entry.delaySec, entry.durationSec)
        const e = easeOutCubic(p)
        if (p >= 1) {
          fg.opacity(opacity)
          fg.x(px.w / 2)
          fg.y(px.h / 2)
        } else {
          switch (entry.type) {
            case 'fade':
              fg.opacity(opacity * e)
              break
            case 'slide':
              fg.opacity(opacity * Math.min(1, p * 1.5))
              fg.x(px.w / 2 + (1 - e) * px.w * 0.6)
              break
            case 'bounce':
              fg.opacity(opacity * Math.min(1, p * 2))
              fg.y(px.h / 2 - (1 - bounceIn(p)) * px.h * 0.45 + 6 * (1 - p))
              break
            default:
              break
          }
        }
      } else if (fg.opacity() !== opacity) {
        fg.opacity(opacity)
      }
      fg.getLayer()?.batchDraw()
    }
    return () => {
      layerFxSlotRef.current = null
    }
  }, [
    layerFxSlotRef,
    imageElement,
    px.w,
    px.h,
    beatsAt,
    fx.breathe,
    fx.breathePeriod,
    fx.rotateDeg,
    fx.glowPulse,
    beatPulse,
    beatPeriodSec,
    entry,
    opacity
  ])

  return (
    <Group ref={fxGroupRef} x={px.w / 2} y={px.h / 2} opacity={opacity}>
      <Group clipFunc={fx.mask === 'none' ? undefined : clipFn}>{imageNode}</Group>
      {borderNode}
    </Group>
  )
}

/** 共享图片层（0.8.0 提取，主图与附加层复用——同一实现=预览/导出同源）：
 * 外层可拖拽 Group（拖动/等比缩放/边界 clamp）+ Transformer 选中 + 无图占位提示 +
 * SharedImageFxLayer 内容。 */
function SharedImageLayer({
  imageElement,
  rect,
  fillMode,
  fx,
  opacity,
  beatPulse,
  beatPeriodSec,
  beatsAt,
  entry,
  selected,
  locked,
  snapCtxRef,
  onSelect,
  onRectChange,
  canvas,
  layerFxSlotRef,
  placeholderLabelKey
}: {
  imageElement: CanvasImageElement | null
  rect: NormRect
  fillMode: MainImageConfig['fillMode']
  fx: ImageFxConfig
  opacity: number
  beatPulse: number
  beatPeriodSec: number | null
  /** 变 BPM 蓄积拍数（可选：跨段变速节拍相位连续） */
  beatsAt?: ((t: number) => number) | null
  /** 入场动画（附加层专用；主图不传 = 无） */
  entry?: OverlayEntryConfig | null
  selected: boolean
  /** 0.9.0 画布锁定：不可选中/拖动/缩放（参数面板仍可调） */
  locked?: boolean
  /** 0.9.0 吸附上下文（SceneLayers 提供） */
  snapCtxRef?: { current: SnapCtx }
  onSelect: () => void
  onRectChange: (rect: NormRect) => void
  canvas: CanvasSize
  layerFxSlotRef?: { current: ((t: number, audioT: number) => void) | null }
  /** 无图占位提示文案 key（主图=拖入封面；附加层=添加图像） */
  placeholderLabelKey: string
}): React.JSX.Element {
  const { t } = useLocale()
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const px = normToPixel(rect, canvas)
  const isCover = fillMode === 'cover'

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selected && !locked) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selected, locked, imageElement, fillMode])

  const commitFromGroup = (node: Konva.Group): void => {
    const r = {
      x: node.x(),
      y: node.y(),
      w: node.width() * node.scaleX(),
      h: node.height() * node.scaleY()
    }
    onRectChange(pixelToNorm(r, canvas))
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        draggable={!locked}
        onClick={() => {
          if (!locked) onSelect()
        }}
        onTap={() => {
          if (!locked) onSelect()
        }}
        onDragStart={() => {
          if (!locked) onSelect()
        }}
        onDragMove={(e: KonvaEventObject<DragEvent>) =>
          snapDragNode(e.target as Konva.Group, snapCtxRef?.current ?? null, canvas)
        }
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          snapCtxRef?.current?.setGuides([])
          commitFromGroup(e.target as Konva.Group)
        }}
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
        {imageElement ? (
          <SharedImageFxLayer
            imageElement={imageElement}
            px={px}
            canvas={canvas}
            fillMode={fillMode}
            fx={fx}
            opacity={opacity}
            beatPulse={beatPulse}
            beatPeriodSec={beatPeriodSec}
            beatsAt={beatsAt}
            entry={entry}
            layerFxSlotRef={layerFxSlotRef}
          />
        ) : (
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
              text={t(placeholderLabelKey)}
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
      {selected && !locked && imageElement && (
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

interface MainImageLayerProps {
  layout: ProjectLayout
  coverElement: CanvasImageElement | null
  canvas: CanvasSize
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  onMainRectChange: (rect: NormRect) => void
  /** 变 BPM 蓄积拍数（可选） */
  beatsAt?: ((t: number) => number) | null
}

/** 主图层：继承共享图片层（拖动/缩放/选中 + 完整 fx 与占位），形态与 0.5.0/0.7.0 完全一致（薄壳）。 */
function MainImageLayer({
  layout,
  coverElement,
  canvas,
  selectedId,
  locked,
  snapCtxRef,
  onSelect,
  onMainRectChange,
  layerFxSlotRef,
  beatsAt
}: MainImageLayerProps & {
  /** 每帧动效更新槽（SceneLayers 分发 frame(t, audioT)） */
  layerFxSlotRef?: { current: ((t: number, audioT: number) => void) | null }
  /** 0.9.0 画布锁定 */
  locked?: boolean
  /** 0.9.0 吸附上下文 */
  snapCtxRef?: { current: SnapCtx }
}): React.JSX.Element {
  return (
    <SharedImageLayer
      imageElement={coverElement}
      rect={layout.mainImage.rect}
      fillMode={layout.mainImage.fillMode}
      fx={layout.mainImage.fx}
      opacity={1}
      beatPulse={layout.beat.pulse}
      beatPeriodSec={beatPeriod(layout.visualizer.bpm, layout.visualizer.beatIntervalSec)}
      beatsAt={beatsAt}
      selected={selectedId === 'mainImage'}
      locked={locked}
      snapCtxRef={snapCtxRef}
      onSelect={() => onSelect('mainImage')}
      onRectChange={onMainRectChange}
      canvas={canvas}
      layerFxSlotRef={layerFxSlotRef}
      placeholderLabelKey="canvas.dropCoverPlaceholder"
    />
  )
}

/** 附加图像层（0.8.0）：多层自由增删（z 序=数组序）；共享图片层实现（拖动/缩放/完整 fx/入场/透明度）。 */
function OverlayLayer({
  cfg,
  imageElement,
  canvas,
  selected,
  locked,
  snapCtxRef,
  onSelect,
  onRectChange,
  slotRegistryRef,
  beatPulse,
  beatPeriodSec,
  beatsAt
}: {
  cfg: OverlayLayerConfig
  imageElement: CanvasImageElement | null
  canvas: CanvasSize
  selected: boolean
  /** 0.9.0 画布锁定 */
  locked?: boolean
  /** 0.9.0 吸附上下文 */
  snapCtxRef?: { current: SnapCtx }
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
  /** 动效槽注册表（SceneLayers 持有）；本层自持 ref，经 effect 注册/注销 */
  slotRegistryRef: {
    current: Map<string, { current: ((t: number, audioT: number) => void) | null }>
  }
  beatPulse: number
  beatPeriodSec: number | null
  /** 变 BPM 蓄积拍数（可选：跨段变速节拍相位连续） */
  beatsAt?: ((t: number) => number) | null
}): React.JSX.Element {
  const localSlotRef = useRef<((t: number, audioT: number) => void) | null>(null)
  useEffect(() => {
    const registry = slotRegistryRef.current // 快照：effect 执行期注册表（ref 对象本身恒不变）
    registry.set(cfg.id, localSlotRef)
    return () => {
      registry.delete(cfg.id)
    }
  }, [slotRegistryRef, cfg.id])
  return (
    <SharedImageLayer
      imageElement={imageElement}
      rect={cfg.rect}
      fillMode={cfg.fillMode}
      fx={cfg.fx}
      opacity={cfg.opacity}
      beatPulse={beatPulse}
      beatPeriodSec={beatPeriodSec}
      beatsAt={beatsAt}
      entry={cfg.entry}
      selected={selected}
      locked={locked}
      snapCtxRef={snapCtxRef}
      onSelect={() => onSelect(`overlay:${cfg.id}`)}
      onRectChange={onRectChange}
      canvas={canvas}
      layerFxSlotRef={localSlotRef}
      placeholderLabelKey="canvas.overlayPlaceholder"
    />
  )
}

interface VisualizerLayerProps {
  config: VisualizerConfig
  /** 0–1 柱高数组（长度 = barCount）；预览=实时频谱，导出=逐帧频谱 */
  bars: number[]
  canvas: CanvasSize
  selected: boolean
  /** 0.9.0 画布锁定 */
  locked?: boolean
  /** 0.9.0 吸附上下文 */
  snapCtxRef?: { current: SnapCtx }
  onSelect: (id: SelectableId) => void
  onRectChange: (rect: NormRect) => void
  barsHandleRef?: { current: ((bars: number[]) => void) | null }
  frameTRef?: { current: ((t: number) => void) | null }
}

/** 可视化层：可拖动选择位置；支持命令式逐帧更新（导出）。
 * 形态：bars（默认，旧几何）/ radial / wave / area / dots / flow（0.4.0）。
 * 全部形态共享同一 bars[] 数据与同一命令式更新通道（核心约束 A）。 */
const DOT_LEVELS = 6
/** Line 的 points 稳定空引用：React 渲染期仅用于建节点，实际值由命令式路径独占更新 */
const NO_POINTS: number[] = []

/** 折线高度 → 像素坐标点（纯函数；slot/baseY/maxH 由调用方传入） */
function linePts(heights: number[], slot: number, baseY: number, maxH: number): number[] {
  const pts: number[] = []
  for (let i = 0; i < heights.length; i++) {
    const v = Math.min(Math.max(heights[i] ?? 0, 0), 1)
    pts.push(i * slot, baseY - Math.max(4, v * maxH))
  }
  return pts
}

function VisualizerLayer({
  config,
  bars,
  canvas,
  selected,
  locked,
  snapCtxRef,
  onSelect,
  onRectChange,
  barsHandleRef,
  frameTRef
}: VisualizerLayerProps): React.JSX.Element {
  const configLocked = locked === true
  const groupRef = useRef<Konva.Group>(null)
  const trRef = useRef<Konva.Transformer>(null)
  const barNodes = useRef<(Konva.Rect | null)[]>([])
  const wedgeNodes = useRef<(Konva.Line | null)[]>([])
  const dotGroups = useRef<(Konva.Group | null)[]>([])
  const lineRef = useRef<Konva.Line | null>(null)
  const line2Ref = useRef<Konva.Line | null>(null)
  const lastTRef = useRef(0)
  // barsRef = "最近一次实际绘制的柱数据"：
  // 命令式路径（applyBars）每帧写入 → frame(t) 通道（flow 相位重绘）使用同一份最新数据，
  // 避免 React bars state 在播放中冻结 → 包络回退为旧谱（只剩细波动）。
  const barsRef = useRef<number[]>(bars)
  useEffect(() => {
    barsRef.current = bars
  }, [bars])
  const px = normToPixel(config.rect, canvas)
  const slot = px.w / config.barCount
  const maxH = px.h * config.heightRatio
  const baseY = px.h
  const style = config.style
  const isLine = style === 'wave' || style === 'flow'

  useEffect(() => {
    const tr = trRef.current
    const node = groupRef.current
    if (tr && node && selected) {
      tr.nodes([node])
      tr.getLayer()?.batchDraw()
    }
  }, [selected, config.rect, style])

  const applyBars = (next: number[]): void => {
    barsRef.current = next
    const g = groupRef.current?.getLayer()
    if (isLine) {
      if (style === 'flow') {
        const line = lineRef.current
        const line2 = line2Ref.current
        if (line) {
          line.points(
            linePts(
              lineHeights('flow', next, lastTRef.current, 0, config.flowWave),
              slot,
              baseY,
              maxH
            )
          )
          line.getLayer()?.batchDraw()
        }
        if (line2) {
          // 副波：半周期相位滞后 → 双层流动
          line2.points(
            linePts(
              lineHeights('flow', next, lastTRef.current, Math.PI, config.flowWave),
              slot,
              baseY,
              maxH
            )
          )
          line2.getLayer()?.batchDraw()
        }
      } else {
        const line = lineRef.current
        if (line) {
          line.points(linePts(lineHeights('wave', next, 0), slot, baseY, maxH))
          line.getLayer()?.batchDraw()
        }
      }
      return
    }
    if (style === 'dots') {
      dotGroups.current.forEach((group, i) => {
        if (!group) return
        const v = Math.min(Math.max(next[i] ?? 0, 0), 1)
        const h = v * maxH
        const dotH = maxH / DOT_LEVELS
        for (let lvl = 0; lvl < DOT_LEVELS; lvl++) {
          const dot = group.children[lvl] as Konva.Circle | undefined
          if (!dot) continue
          const y = baseY - dotH * (lvl + 0.5)
          dot.y(y)
          const active = h > dotH * lvl
          dot.visible(active)
          if (active) dot.opacity(Math.min(1, (h - dotH * lvl) / dotH + 0.4))
        }
      })
      g?.batchDraw()
      return
    }
    if (style === 'radial') {
      wedgeNodes.current.forEach((node, i) => {
        if (!node) return
        node.points(
          wedgeGeometry(i, next[i] ?? 0, config.barCount, px.w, px.h, config.barWidthRatio)
        )
      })
      g?.batchDraw()
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

  // 命令式更新注册（一次）——内部读 implRef 的最新实现，任何重渲染不丢 sink
  const implRef = useRef<{ bars: (b: number[]) => void; frame: (t: number) => void }>({
    bars: () => undefined,
    frame: () => undefined
  })
  useEffect(() => {
    implRef.current.bars = applyBars
    implRef.current.frame = (t: number) => {
      lastTRef.current = t
      if (style === 'flow') applyBars(barsRef.current)
    }
  })

  // pause/seek 走 state 路径后立即重绘（须在 implRef 注册之后）：
  // flow 渲染点独占命令式（React 不参与），若不重绘，本次 state 更新会留下
  // "旧包络+新相位"直到下次播放触发。
  useEffect(() => {
    if (style === 'flow') implRef.current.bars(bars)
  }, [bars, style])

  // 首绘：style/几何变化后，等 refs 绑定完成再跑一次全量更新（React props 不驱动 Line points）。
  useEffect(() => {
    const id = requestAnimationFrame(() => implRef.current.bars(barsRef.current))
    return () => cancelAnimationFrame(id)
  }, [
    style,
    config.rect,
    config.barCount,
    config.barWidthRatio,
    config.gapRatio,
    config.heightRatio,
    config.colors
  ])

  useEffect(() => {
    if (!barsHandleRef) return
    barsHandleRef.current = (b: number[]) => implRef.current.bars(b)
    return () => {
      barsHandleRef.current = null
    }
  }, [barsHandleRef])

  useEffect(() => {
    if (!frameTRef) return
    frameTRef.current = (t: number) => implRef.current.frame(t)
    return () => {
      frameTRef.current = null
    }
  }, [frameTRef])

  // 渲染期几何：bars/radial 用 Rect；dots 用点组；wave 单线、flow 双线。
  // ⚠ Line 的 points 不由 React props 提供（数组新引用会覆盖命令式更新）：
  // React 只建节点，points 由命令式路径（applyBars）独占，绑定后立即首绘。
  const bindLine = (
    node: Konva.Line | null,
    ref: React.MutableRefObject<Konva.Line | null>
  ): void => {
    ref.current = node
  }

  // 渲染期 points（useMemo 稳定：bars state 更新 → 重算 → React 更新节点；
  // 命令式更新期间 bars 引用不变 → 返回旧引用 → react-konva 判未变 → 不覆盖命令式值）
  const renderPts = useMemo(() => {
    if (style !== 'wave') return NO_POINTS
    return linePts(lineHeights('wave', bars, 0), slot, baseY, maxH)
  }, [style, bars, slot, baseY, maxH])

  // flow 不做渲染期 points（React 不参与 flow 绘制）：
  // 相位/波形全部由命令式路径独占更新（frameT 通道），暂停/seek 时也会触发一次
  // 命令式更新 → 与播放末帧连续，无突变，也无 React 覆盖风险。

  const renderShape = (): React.JSX.Element[] | React.JSX.Element => {
    if (isLine) {
      const firstColor = config.colors[0] ?? '#ff5f9e'
      const lastColor = config.colors[config.colors.length - 1] ?? firstColor
      if (style === 'flow') {
        return (
          <>
            <KonvaLine
              key="flow-secondary"
              name="viz-line-2"
              ref={(el) => bindLine(el, line2Ref)}
              points={NO_POINTS}
              stroke={lastColor}
              strokeWidth={2}
              opacity={0.55}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
            <KonvaLine
              key="flow-primary"
              name="viz-line"
              ref={(el) => bindLine(el, lineRef)}
              points={NO_POINTS}
              stroke={firstColor}
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
              listening={false}
            />
          </>
        )
      }
      return (
        <KonvaLine
          name="viz-line"
          ref={(el) => bindLine(el, lineRef)}
          points={renderPts}
          stroke={firstColor}
          strokeWidth={3}
          lineCap="round"
          lineJoin="round"
          listening={false}
        />
      )
    }
    if (style === 'dots') {
      const dotR = Math.max(2, Math.min(slot, maxH / DOT_LEVELS) * 0.32)
      const arr: React.JSX.Element[] = []
      for (let i = 0; i < config.barCount; i++) {
        arr.push(
          <Group
            key={i}
            ref={(el) => {
              dotGroups.current[i] = el
            }}
            x={i * slot + slot / 2}
          >
            {Array.from({ length: DOT_LEVELS }, (_, lvl) => (
              <Circle
                key={lvl}
                radius={dotR}
                y={baseY - (maxH / DOT_LEVELS) * (lvl + 0.5)}
                fill={colorAt(config.colors, i / Math.max(1, config.barCount - 1))}
                listening={false}
              />
            ))}
          </Group>
        )
      }
      return arr
    }
    if (style === 'radial') {
      const bindWedge = (node: Konva.Line | null, i: number): void => {
        wedgeNodes.current[i] = node
      }
      return Array.from({ length: config.barCount }, (_, i) => (
        <KonvaLine
          key={i}
          ref={(el) => bindWedge(el, i)}
          points={NO_POINTS}
          closed
          fill={colorAt(config.colors, i / Math.max(1, config.barCount - 1))}
          listening={false}
        />
      ))
    }
    return Array.from({ length: config.barCount }, (_, i) => {
      const v = Math.min(Math.max(bars[i] ?? 0, 0), 1)
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
    })
  }

  return (
    <>
      <Group
        ref={groupRef}
        x={px.x}
        y={px.y}
        width={px.w}
        height={px.h}
        draggable={!configLocked}
        onClick={() => {
          if (!configLocked) onSelect('visualizer')
        }}
        onTap={() => {
          if (!configLocked) onSelect('visualizer')
        }}
        onDragStart={() => {
          if (!configLocked) onSelect('visualizer')
        }}
        onDragMove={(e: KonvaEventObject<DragEvent>) =>
          snapDragNode(e.target as Konva.Group, snapCtxRef?.current ?? null, canvas)
        }
        onDragEnd={(e: KonvaEventObject<DragEvent>) => {
          snapCtxRef?.current?.setGuides([])
          const node = e.target as Konva.Group
          const w = Math.max(40, node.width())
          const h = Math.max(20, node.height())
          onRectChange(pixelToNorm({ x: node.x(), y: node.y(), w, h }, canvas))
        }}
        dragBoundFunc={(pos) => {
          const node = groupRef.current
          if (!node) return pos
          return clampPos(pos, node.width(), node.height(), canvas)
        }}
      >
        {/* 透明命中区：整个矩形（含柱子间空隙）都可拖动/选中 */}
        <Rect width={px.w} height={px.h} fill="rgba(0,0,0,0.01)" />
        {renderShape()}
      </Group>
      {selected && !configLocked && (
        <Transformer
          ref={trRef}
          rotateEnabled={false}
          resizeEnabled={true}
          keepRatio={false}
          enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
          borderStroke={SELECT_BORDER}
          borderDash={[6, 4]}
          anchorStroke={SELECT_BORDER}
          anchorFill="#ffffff"
          anchorSize={10}
          boundBoxFunc={(oldBox, newBox) => {
            if (newBox.width < 40 || newBox.height < 20) return oldBox
            return newBox
          }}
          onTransformEnd={(e) => {
            const node = e.target as Konva.Group
            onRectChange(
              pixelToNorm(
                {
                  x: node.x(),
                  y: node.y(),
                  w: Math.max(40, node.width() * node.scaleX()),
                  h: Math.max(20, node.height() * node.scaleY())
                },
                canvas
              )
            )
            node.scale({ x: 1, y: 1 })
          }}
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
    onExtraTextRectChange,
    onVisualizerRectChange,
    bars,
    canvasSize,
    layers,
    barsHandleRef,
    frameTRef,
    analyzer,
    layerFxRef,
    audioLeadSec,
    mediaDurationSec,
    overlayElements,
    onOverlayRectChange,
    beatsAt
  } = props
  /** 变 BPM 蓄积拍数（缺省按本布局推导：分段常量积分——含分段节拍源/轨道关键帧）；
   * useMemo 稳定（预览由 App 传入（项目布局闭包）；导出缺省按本布局推导） */
  const beatsAtFn = useMemo(
    () => beatsAt ?? ((u: number): number => beatTimeAt(layout, u)),
    [layout, beatsAt]
  )
  const defaultCanvas = useMemo(() => ({ width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }), [])
  const canvas = canvasSize ?? defaultCanvas
  const show = (name: SceneLayerName): boolean => !layers || layers.includes(name)
  // 吸附上下文（0.9.0）：目标集（排除自身由拖动组负责）+ 开关；引导线 state 驱动 SnapGuidesLayer
  const [snapGuides, setSnapGuides] = useState<SnapLine[]>([])
  const snapCtxRef = useRef<SnapCtx>({ enabled: true, targets: [], setGuides: () => undefined })
  useEffect(() => {
    const cw = canvas
    const hiddenIds = new Set((layout.layers ?? []).filter((l) => l.hidden).map((l) => l.id))
    const targets: SnapRect[] = []
    const push = (id: string, r: NormRect): void => {
      if (hiddenIds.has(id)) return
      targets.push(normToPixel(r, cw))
    }
    push('main', layout.mainImage.rect)
    push('songTitle', layout.texts.songTitle.rect)
    push('artist', layout.texts.artist.rect)
    for (const [tid, tcfg] of Object.entries(layout.texts.extraTexts ?? {}))
      push('text:' + tid, tcfg.rect)
    push('visualizer', layout.visualizer.rect)
    for (const o of layout.overlayLayers ?? []) push('overlay:' + o.id, o.rect)
    snapCtxRef.current = {
      enabled: layout.editor.snapEnabled,
      targets,
      setGuides: setSnapGuides
    }
  }, [layout, canvas])
  // 非可视化动效每帧分发：SceneLayers 统一注册外部 layerFxRef，
  // 各子层（背景/主图/文本/片头片尾）写入自己的 slot（getter 惰性读取不回退重绘）。
  // 0.7.0：audioT = 音频时间轴（导出 lead>0 时由 setFrame 传入；预览缺省 = t）。
  const bgFxSlot = useRef<((t: number, audioT: number) => void) | null>(null)
  const imgFxSlot = useRef<((t: number, audioT: number) => void) | null>(null)
  const titleFxSlot = useRef<((t: number) => void) | null>(null)
  const artistFxSlot = useRef<((t: number) => void) | null>(null)
  const introFxSlot = useRef<((t: number, audioT: number) => void) | null>(null)
  // 附加层动效槽注册表（0.8.0）：OverlayLayer 自持 ref 对象，经 effect 注册/注销
  const overlaySlotsRef = useRef(
    new Map<string, { current: ((t: number, audioT: number) => void) | null }>()
  )
  // 1.1.1 自定义文本框入场槽：子组件持 ref + effect 注册/注销（渲染期不读 map——满足 react-hooks/refs）
  const textSlotsRef = useRef<Map<string, { current: ((t: number) => void) | null }>>(new Map())
  useEffect(() => {
    if (!layerFxRef) return
    layerFxRef.current = (t: number, audioT?: number) => {
      const at = audioT ?? t
      bgFxSlot.current?.(t, at)
      imgFxSlot.current?.(t, at)
      titleFxSlot.current?.(t)
      artistFxSlot.current?.(t)
      textSlotsRef.current.forEach((slot) => slot.current?.(t))
      introFxSlot.current?.(t, at)
      overlaySlotsRef.current.forEach((slot) => slot.current?.(t, at))
    }
    return () => {
      layerFxRef.current = null
    }
  }, [layerFxRef])

  // 0.9.0：按图层顺序渲染（layers 数组序；null = 默认序：背景→主图→附加层→歌名→作者→可视化）；
  // hidden 不渲染、locked 画布禁选禁拖（预览/导出同一渲染代码 → 同源）；fx 特效层永远最后（置顶）
  const layerItems: { id: string; hidden: boolean; locked: boolean }[] =
    layout.layers ??
    defaultLayerOrder(
      (layout.overlayLayers ?? []).map((o) => 'overlay:' + o.id),
      Object.keys(layout.texts.extraTexts ?? {}).map((id) => 'text:' + id)
    ).map((id) => ({
      id,
      hidden: false,
      locked: false
    }))
  const elemName = (id: string): SceneLayerName =>
    id.startsWith('overlay:') ? 'overlay' : id.startsWith('text:') ? 'text' : (id as SceneLayerName)
  return (
    <>
      {layerItems.map((item) => {
        if (item.hidden) return null
        if (!show(elemName(item.id))) return null
        switch (item.id) {
          case 'background':
            return (
              <Layer key={item.id} name="background" listening={false}>
                <BackgroundLayer
                  layout={layout}
                  coverElement={coverElement}
                  bgElement={bgElement}
                  analyzer={analyzer}
                  canvas={canvas}
                  layerFxSlotRef={bgFxSlot}
                  beatsAt={beatsAtFn}
                />
              </Layer>
            )
          case 'main':
            return (
              <Layer key={item.id} name="main">
                <MainImageLayer
                  layout={layout}
                  coverElement={coverElement}
                  canvas={canvas}
                  selectedId={selectedId}
                  locked={item.locked}
                  snapCtxRef={snapCtxRef}
                  onSelect={onSelect}
                  onMainRectChange={onMainRectChange}
                  layerFxSlotRef={imgFxSlot}
                  beatsAt={beatsAtFn}
                />
              </Layer>
            )
          case 'songTitle':
          case 'artist': {
            const kind = item.id
            return (
              <Layer key={item.id} name={kind}>
                <TextNode
                  kind={kind}
                  cfg={kind === 'songTitle' ? layout.texts.songTitle : layout.texts.artist}
                  canvas={canvas}
                  selected={selectedId === kind}
                  locked={item.locked}
                  snapCtxRef={snapCtxRef}
                  onSelect={onSelect}
                  onRectChange={(rect) => onTextRectChange(kind, rect)}
                  textFxSlotRef={kind === 'songTitle' ? titleFxSlot : artistFxSlot}
                />
              </Layer>
            )
          }
          case 'visualizer':
            return (
              <Layer key={item.id} name="visualizer">
                <VisualizerLayer
                  config={layout.visualizer}
                  bars={bars}
                  canvas={canvas}
                  selected={selectedId === 'visualizer'}
                  locked={item.locked}
                  snapCtxRef={snapCtxRef}
                  onSelect={onSelect}
                  onRectChange={onVisualizerRectChange}
                  barsHandleRef={barsHandleRef}
                  frameTRef={frameTRef}
                />
              </Layer>
            )
          default: {
            if (typeof item.id !== 'string') return null
            if (item.id.startsWith('text:')) {
              // 1.1.1 自定义文本框：与歌曲名/作者同渲染（TextNode）+ 同选中/拖动/入场动画；
              // slot 由 ExtraTextBox 自持（渲染期零 ref 读取——react-hooks/refs）
              const tid = item.id.slice('text:'.length)
              const tcfg = (layout.texts.extraTexts ?? {})[tid]
              if (!tcfg) return null
              return (
                <Layer key={item.id} name="text">
                  <ExtraTextBox
                    tid={tid}
                    cfg={tcfg}
                    canvas={canvas}
                    selected={selectedId === 'text:' + tid}
                    locked={item.locked}
                    snapCtxRef={snapCtxRef}
                    onSelect={onSelect}
                    onRectChange={(rect) => onExtraTextRectChange?.(tid, rect)}
                    textSlotsRef={textSlotsRef}
                  />
                </Layer>
              )
            }
            if (!item.id.startsWith('overlay:')) return null
            const o = (layout.overlayLayers ?? []).find((x) => 'overlay:' + x.id === item.id)
            if (!o) return null
            return (
              <Layer key={item.id} name="overlay">
                <OverlayLayer
                  cfg={o}
                  imageElement={overlayElements?.[o.id] ?? null}
                  canvas={canvas}
                  selected={selectedId === 'overlay:' + o.id}
                  locked={item.locked}
                  snapCtxRef={snapCtxRef}
                  onSelect={onSelect}
                  onRectChange={(rect) => onOverlayRectChange?.(o.id, rect)}
                  slotRegistryRef={overlaySlotsRef}
                  beatPulse={layout.beat.pulse}
                  beatPeriodSec={beatPeriod(
                    layout.visualizer.bpm,
                    layout.visualizer.beatIntervalSec
                  )}
                  beatsAt={beatsAtFn}
                />
              </Layer>
            )
          }
        }
      })}
      {snapGuides.length > 0 && (
        <Layer key="snap-guides" name="snap-guides" listening={false}>
          {snapGuides.map((l, i) => (
            <SnapLineNode
              key={i}
              points={
                l.axis === 'v' ? [l.pos, 0, l.pos, canvas.height] : [0, l.pos, canvas.width, l.pos]
              }
              stroke="#ff5f9e"
              strokeWidth={1}
              dash={[6, 4]}
              listening={false}
            />
          ))}
        </Layer>
      )}
      {show('fx') && (
        <Layer key="fx" name="fx" listening={false}>
          <IntroOutroLayer
            layout={layout}
            canvas={canvas}
            mediaDurationSec={mediaDurationSec}
            leadSec={audioLeadSec}
            fxSlotRef={introFxSlot}
          />
        </Layer>
      )}
    </>
  )
}
