/**
 * 归一化布局模型（核心约束 B）。
 * 坐标约定：x / y / w 相对画布宽（0–1），h 相对画布高（0–1）。
 * 字号、描边宽、发光半径等尺寸同样相对画布高。
 * 预览与导出共用本模型；序列化 = JSON.stringify(ProjectLayout)。
 */

export interface NormRect {
  x: number
  y: number
  w: number
  h: number
}

export interface PixelRect {
  x: number
  y: number
  w: number
  h: number
}

export interface CanvasSize {
  width: number
  height: number
}

export interface TextStyle {
  fontFamily: string
  /** 相对画布高（0–1） */
  fontSize: number
  color: string
  strokeColor: string
  /** 相对画布高（0–1） */
  strokeWidth: number
  glowColor: string
  /** 相对画布高（0–1） */
  glowBlur: number
  glowEnabled: boolean
  bold: boolean
  align: 'left' | 'center' | 'right'
}

export interface BackgroundConfig {
  /** false = 纯色背景，不用图片 */
  useImage: boolean
  /** 背景图片来源：cover = 封面图（默认）；custom = 额外上传的独立背景图 */
  imageSource: 'cover' | 'custom'
  /** 背景色；透明封面先与此色合成再模糊 */
  color: string
  /** 高斯模糊强度 0–100 */
  blur: number
  /** 压暗不透明度 0–1 */
  dimOpacity: number
}

export interface MainImageConfig {
  rect: NormRect
  /** contain=等比适配留透明边（默认，永不变形）/ cover=等比铺满裁切 / stretch=拉伸填满（可能变形） */
  fillMode: 'contain' | 'cover' | 'stretch'
}

/** 可视化形态：bars=柱形（默认，历史行为）；radial/wave/area/dots/flow=可选形态（0.4.0） */
export type VisualizerStyle = 'bars' | 'radial' | 'wave' | 'area' | 'dots' | 'flow'

export interface VisualizerConfig {
  style: VisualizerStyle
  rect: NormRect
  /** 柱数 100–160，默认 128 */
  barCount: number
  /** 频谱显示范围下限（Hz，对数分桶起点），默认 30 */
  freqMin: number
  /** 频谱显示范围上限（Hz，对数分桶终点），默认 8000（原 16000：4k–16k 段音乐能量极少，右侧柱无起伏） */
  freqMax: number
  /** 柱宽占槽宽比例 0–1 */
  barWidthRatio: number
  /** 柱间间距占槽宽比例 0–1 */
  gapRatio: number
  /** 柱最大高度占 rect.h 比例 0–1 */
  heightRatio: number
  /** 单色=[c]；多色/渐变=[c1,c2,...] 从左到右插值 */
  colors: string[]
  /** 柱顶圆角（逻辑像素） */
  roundness: number
  /** 时间平滑 0–1（0=无平滑）——保留兼容：由 attack/decay 派生，UI 改双系数 */
  smoothing: number
  /** 上升系数 0–1（越大上升越慢），默认 0.1（响应快） */
  attack: number
  /** 下降系数 0–1（越大回落越慢），默认平滑时间的近似（0.3，保留旧观感） */
  decay: number
  /** 频谱帽回落速率 0–1/帧（0=关闭下落动画=旧行为） */
  peakFall: number
  /** 灵敏度增益 1–15，越大柱越高越灵敏（默认 7；原固定增益 4 经用户反馈偏低） */
  sensitivity: number
  /** 节拍响应：bpm=null（默认）不检测；数字=手动 BPM；0.6.0 自动检测可写入 */
  bpm: number | null
  /** 可视化-音频偏移（ms，仅可视化时间轴，默认 0） */
  offsetMs: number
}

export interface TextLayerConfig {
  text: string
  style: TextStyle
  rect: NormRect
}

/** 可选分辨率（16:9）；未来扩展其他比例 = 在数组里加项即可 */
export interface ResolutionOption {
  id: string
  label: string
  width: number
  height: number
}

export const RESOLUTIONS: ResolutionOption[] = [
  { id: '720p', label: '1280×720', width: 1280, height: 720 },
  { id: '1080p', label: '1920×1080', width: 1920, height: 1080 },
  { id: '2k', label: '2560×1440', width: 2560, height: 1440 },
  { id: '4k', label: '3840×2160', width: 3840, height: 2160 }
]

export interface ExportConfig {
  /** RESOLUTIONS 中的 id，默认 1080p（Q6） */
  resolutionId: string
  /** 30 或 60，默认 30（规格）；60 更丝滑但编码耗时约翻倍 */
  fps: number
}

export interface ProjectLayout {
  version: 1
  canvas: CanvasSize
  background: BackgroundConfig
  mainImage: MainImageConfig
  texts: {
    songTitle: TextLayerConfig
    artist: TextLayerConfig
  }
  visualizer: VisualizerConfig
  export: ExportConfig
}

export const LOGICAL_WIDTH = 1920
export const LOGICAL_HEIGHT = 1080

/** CJK 安全字体栈：Windows 优先 Segoe UI → 微软雅黑，回退系统默认 */
export const CJK_FONT_STACK =
  '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", "Source Han Sans SC", sans-serif'

/** 默认布局：对齐规格 §4 数值坐标（M3 完成后按参考图目视比对微调） */
export const DEFAULT_LAYOUT: ProjectLayout = {
  version: 1,
  canvas: { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT },
  background: {
    useImage: true,
    imageSource: 'cover',
    color: '#ffffff',
    blur: 25,
    dimOpacity: 0.3
  },
  mainImage: {
    // 主图：左侧、垂直居中、高度≈画布 90%、宽≈画布 40%（用户目视反馈：整体上移 2%）
    rect: { x: 0.04, y: 0.03, w: 0.38, h: 0.9 },
    // 用户确认：等比适配，图片完整显示、永不变形（矩形内留透明边）
    fillMode: 'contain'
  },
  texts: {
    songTitle: {
      text: '歌曲名',
      style: {
        fontFamily: CJK_FONT_STACK,
        fontSize: 0.095,
        color: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 0.004,
        glowColor: '#000000',
        glowBlur: 0.01,
        glowEnabled: true,
        bold: true,
        align: 'left'
      },
      // §4：x≈54%、y≈15%（用户目视反馈后上移至 13%）
      rect: { x: 0.54, y: 0.13, w: 0.4, h: 0.12 }
    },
    artist: {
      text: '作者',
      style: {
        fontFamily: CJK_FONT_STACK,
        fontSize: 0.05,
        color: '#ffffff',
        strokeColor: '#000000',
        strokeWidth: 0.002,
        glowColor: '#000000',
        glowBlur: 0.008,
        glowEnabled: true,
        bold: false,
        align: 'left'
      },
      // §4：作者在歌名下方，y≈26%（上移后 24.5%）
      rect: { x: 0.54, y: 0.245, w: 0.4, h: 0.07 }
    }
  },
  visualizer: {
    style: 'bars',
    // §4：横向 [49%, 97%]、中心 y≈49%（用户目视反馈后上移，中心 47%）
    rect: { x: 0.49, y: 0.38, w: 0.48, h: 0.18 },
    barCount: 128,
    freqMin: 30,
    freqMax: 8000,
    barWidthRatio: 0.55,
    gapRatio: 0.45,
    heightRatio: 0.92,
    colors: ['#ff5f9e', '#7ce3ff'],
    roundness: 2,
    smoothing: 0.2,
    attack: 0.1,
    decay: 0.3,
    peakFall: 0,
    sensitivity: 7,
    bpm: null,
    offsetMs: 0
  },
  export: {
    resolutionId: '1080p',
    fps: 30
  }
}

/** 归一化 → 像素 */
export function normToPixel(rect: NormRect, canvas: CanvasSize): PixelRect {
  return {
    x: rect.x * canvas.width,
    y: rect.y * canvas.height,
    w: rect.w * canvas.width,
    h: rect.h * canvas.height
  }
}

/** 像素 → 归一化 */
export function pixelToNorm(rect: PixelRect, canvas: CanvasSize): NormRect {
  return {
    x: rect.x / canvas.width,
    y: rect.y / canvas.height,
    w: rect.w / canvas.width,
    h: rect.h / canvas.height
  }
}

/** 相对画布高的尺寸 → 像素 */
export function relToPixel(v: number, canvas: CanvasSize): number {
  return v * canvas.height
}

/** 将矩形限制在画布内（保持 w/h 不变；w/h 超界时缩小并归零位置） */
export function clampNormRect(rect: NormRect): NormRect {
  const w = Math.min(Math.max(rect.w, 0.01), 1)
  const h = Math.min(Math.max(rect.h, 0.01), 1)
  return {
    x: Math.min(Math.max(rect.x, 0), 1 - w),
    y: Math.min(Math.max(rect.y, 0), 1 - h),
    w,
    h
  }
}

/** 规范化矩形：x/y 允许 0，w/h 必须为正；非法值用兜底替换 */
export function sanitizeNormRect(rect: NormRect): NormRect {
  const nonNeg = (v: number): boolean => Number.isFinite(v) && v >= 0
  const positive = (v: number): boolean => Number.isFinite(v) && v > 0
  return {
    x: nonNeg(rect.x) ? rect.x : 0,
    y: nonNeg(rect.y) ? rect.y : 0,
    w: positive(rect.w) ? rect.w : 0.1,
    h: positive(rect.h) ? rect.h : 0.1
  }
}

/** 下半区阈值：y > 0.55 视为字幕区（拖入仅警告） */
export const SUBTITLE_ZONE_Y = 0.55
