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
  /** 背景动效（0.5.0，默认全关） */
  fx: BackgroundFxConfig
}

/** 背景动效（0.5.0） */
export interface BackgroundFxConfig {
  /** Ken Burns 慢速缩放平移幅度 0–1（0=关；常用 0.02–0.1） */
  kenBurns: number
  /** Ken Burns 单程周期秒（越大越慢；默认 30） */
  kenBurnsDuration: number
  /** 随 bass 呼吸的亮度 0–1（0=关；正=随低音变亮） */
  bassBrightness: number
  /** 随 bass 呼吸的色相偏移 0–1（0=关；±强度×20°） */
  bassHue: number
}

export interface MainImageConfig {
  rect: NormRect
  /** contain=等比适配留透明边（默认，永不变形）/ cover=等比铺满裁切 / stretch=拉伸填满（可能变形） */
  fillMode: 'contain' | 'cover' | 'stretch'
  /** 主图动效（0.5.0，默认全关） */
  fx: ImageFxConfig
}

/** 主图动效（0.5.0） */
export interface ImageFxConfig {
  /** 呼吸缩放 0–1（0=关；幅度 = 强度×4% 缩放） */
  breathe: number
  /** 呼吸周期秒（默认 4） */
  breathePeriod: number
  /** 微旋转幅度（度；0=关；缓慢往复 ±rotateDeg） */
  rotateDeg: number
  /** 发光脉冲 0–1（0=关；0–1 强度） */
  glowPulse: number
  /** 形状遮罩：none=关 | circle=圆形 | star=星形 */
  mask: 'none' | 'circle' | 'star'
  /** 边框装饰线宽（相对画布高 0–1；0=关） */
  border: number
  /** 边框颜色 */
  borderColor: string
}

/** 文本入场动画（0.5.0） */
export interface TextEntryConfig {
  /** none=无（默认，连续显示）| fade=淡入 | slide=滑入 | typewriter=打字机 | bounce=逐字弹跳 */
  type: 'none' | 'fade' | 'slide' | 'typewriter' | 'bounce'
  /** 动画时长秒（0.3–5；默认 1.2） */
  durationSec: number
  /** 相对播放起点的延迟秒（默认 0） */
  delaySec: number
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
  /** 节拍响应（0.6.0 手动节拍源）：bpm=每分钟拍数（自由输入，仅校验>0 且有限；null=不使用 BPM）；
   * 两者同时设置时 BPM 优先；均 null=节拍关闭 */
  bpm: number | null
  /** 节拍响应：周期秒（自由输入，>0 且有限；null=不使用周期）——"每 N 秒一次"语义 */
  beatIntervalSec: number | null
  /** 可视化-音频偏移（ms，仅可视化时间轴，默认 0；±500 由 UI 滑块约束，负值=可视化滞后于音频） */
  offsetMs: number
  /** flow（流动光带）波动强度 0–1：0=纯频谱轮廓，1=±75% 强波动（默认 0.7） */
  flowWave: number
}

export interface TextLayerConfig {
  text: string
  style: TextStyle
  rect: NormRect
  /** 入场动画（0.5.0，默认 none） */
  entry: TextEntryConfig
}

/** 全局后期（CanvasFX 管线，0.5.0，默认全关） */
export interface CanvasFxConfig {
  /** 暗角 0–1（0=关） */
  vignette: number
  /** 胶片颗粒 0–1（0=关；时间种子确定性） */
  grain: number
  /** 扫描线 0–1（0=关；透明度） */
  scanline: number
  /** 踩点闪光 0–1（0=关；bass 能量阶跃触发白闪） */
  beatFlash: number
  /** 光斑/漏光 0–1（0=关；内置素材 + globalCompositeOperation 叠加） */
  lightLeak: number
}

/** 粒子预设（0.6.0） */
export type ParticlePreset = 'snow' | 'sakura' | 'star' | 'bubble'

/** 音频工程（0.7.0，默认全 0 = 与 0.6.5 输出一致）：
 * leadMs = 前导留白：导出视频帧 +前导、黑场/标题卡填充；预览播放同时间轴（所见即所得），
 * 淡入淡出作用导出音频（afade）；偏移校准见 visualizer.offsetMs（预览/导出同偏移）。 */
export interface AudioEngineConfig {
  /** 前导留白毫秒（KTV 前奏；0=关；1ms 精度，存储取整） */
  leadMs: number
  /** 导出音频淡入秒（0=关；0–10） */
  fadeInSec: number
  /** 导出音频淡出秒（0=关；0–10；从音频末尾计） */
  fadeOutSec: number
}

/** 音乐响应（0.6.0，默认全关；节拍源 = visualizer.bpm / visualizer.beatIntervalSec 手动输入） */
export interface BeatFxConfig {
  /** 全局踩点脉冲 0–1（0=关）：beat 起点背景亮度短闪 + 主图 Kick 缩放 */
  pulse: number
  /** 粒子爆发强度 0–1（0=关）：beat 起点喷发 */
  burst: number
  /** 粒子预设（0.6.0） */
  particlePreset: ParticlePreset
  /** 粒子密度 0–1（0=关） */
  particleDensity: number
}

/** 片头/片尾（0.5.0，默认全关） */
export interface IntroOutroConfig {
  /** 片头黑场淡入时长秒（0=关） */
  introFade: number
  /** 片头标题卡展示秒（0=关；淡入后叠加，复用歌名/作者样式居中） */
  introTitleCard: number
  /** 片尾淡出时长秒（0=关） */
  outroFade: number
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
  /** 全局后期叠加（0.5.0） */
  canvasFx: CanvasFxConfig
  /** 片头/片尾（0.5.0） */
  introOutro: IntroOutroConfig
  /** 音乐响应（0.6.0） */
  beat: BeatFxConfig
  /** 音频工程（0.7.0） */
  audio: AudioEngineConfig
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
    dimOpacity: 0.3,
    fx: { kenBurns: 0, kenBurnsDuration: 30, bassBrightness: 0, bassHue: 0 }
  },
  mainImage: {
    // 主图：左侧、垂直居中、高度≈画布 90%、宽≈画布 40%（用户目视反馈：整体上移 2%）
    rect: { x: 0.04, y: 0.03, w: 0.38, h: 0.9 },
    // 用户确认：等比适配，图片完整显示、永不变形（矩形内留透明边）
    fillMode: 'contain',
    fx: {
      breathe: 0,
      breathePeriod: 4,
      rotateDeg: 0,
      glowPulse: 0,
      mask: 'none',
      border: 0,
      borderColor: '#ffffff'
    }
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
      rect: { x: 0.54, y: 0.13, w: 0.4, h: 0.12 },
      entry: { type: 'none', durationSec: 1.2, delaySec: 0 }
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
      rect: { x: 0.54, y: 0.245, w: 0.4, h: 0.07 },
      entry: { type: 'none', durationSec: 1.2, delaySec: 0 }
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
    beatIntervalSec: null,
    offsetMs: 0,
    flowWave: 0.7
  },
  canvasFx: { vignette: 0, grain: 0, scanline: 0, beatFlash: 0, lightLeak: 0 },
  introOutro: { introFade: 0, introTitleCard: 0, outroFade: 0 },
  beat: { pulse: 0, burst: 0, particlePreset: 'snow', particleDensity: 0 },
  audio: { leadMs: 0, fadeInSec: 0, fadeOutSec: 0 },
  export: {
    resolutionId: '1080p',
    fps: 30
  }
}

/** 0.5.0 动效快照：是否存在随时间变化的特效（无 → 导出走静态缓存快速路径，输出与 0.4.0 一致） */
export function hasDynamicFx(layout: ProjectLayout): boolean {
  const b = layout.background.fx
  if (b.kenBurns > 0 || b.bassBrightness > 0 || b.bassHue > 0) return true
  const i = layout.mainImage.fx
  if (i.breathe > 0 || i.rotateDeg > 0 || i.glowPulse > 0) return true
  if (layout.texts.songTitle.entry.type !== 'none' || layout.texts.artist.entry.type !== 'none')
    return true
  const io = layout.introOutro
  if (io.introFade > 0 || io.introTitleCard > 0 || io.outroFade > 0) return true
  return (
    layout.canvasFx.vignette > 0 ||
    layout.canvasFx.grain > 0 ||
    layout.canvasFx.scanline > 0 ||
    layout.canvasFx.beatFlash > 0 ||
    layout.canvasFx.lightLeak > 0
  )
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
