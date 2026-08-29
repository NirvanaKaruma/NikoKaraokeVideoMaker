/**
 * fx 时间函数库（核心约束 A 的动效侧）：
 * 预览（rAF currentTime）与导出（逐帧 tSec）调用同一批纯函数，保证所见即所得。
 * 全部为确定性函数：给定 (t, seed, params) → 相同结果，30/60fps 导出序列一致。
 */

/** 对数分带能量：把 [freqMin, freqMax] 按人对数感知切成 bandCount 段，各返回 0–1 能量 */
export interface BandEnergies {
  /** 低音（最低频段） */
  bass: number
  lowMid: number
  mid: number
  treble: number
}

/** 由 bars 数组（0–1，长度 n）计算分带能量：bar 区间按比例切分（日志分桶已是等对数间距） */
export function bandEnergiesFromBars(bars: ArrayLike<number>): BandEnergies {
  const n = bars.length
  if (n === 0) return { bass: 0, lowMid: 0, mid: 0, treble: 0 }
  // 分带能量口径：段内峰值（软限幅后的幅度谱本身 0–1；峰值口径对"单音集中"与
  // "宽频铺开"都灵敏，且天然适合驱动动效的"强度"语义）
  const bandValue = (s: number, e: number): number => {
    const s0 = Math.max(0, Math.floor(s))
    const e0 = Math.min(n, Math.round(e))
    if (e0 <= s0) return 0
    let peak = 0
    for (let i = s0; i < e0; i++) {
      const v = bars[i]
      if (v > peak) peak = v
    }
    return peak
  }
  // 对数感知：人耳低频分辨率高，等对数段分布更符合听感（频率范围已是对数分桶）
  return {
    bass: bandValue(0, n * 0.25),
    lowMid: bandValue(n * 0.25, n * 0.5),
    mid: bandValue(n * 0.5, n * 0.75),
    treble: bandValue(n * 0.75, n)
  }
}

/** 平滑升级：attack/decay 双系数（上升快、下降慢）+ 可选峰值帽（peakFall）。
 * 与旧 smoothBars 全兼容：attack === decay 时退化为等权平滑。
 */
export interface SmoothFxState {
  prev: Float32Array | null
  peak: Float32Array | null
}

export function smoothBarsFx(
  st: SmoothFxState,
  target: Float32Array,
  attack: number,
  decay: number,
  peakFall: number,
  out: Float32Array | null = null
): Float32Array {
  const n = target.length
  if (!st.prev || st.prev.length !== n) {
    st.prev = Float32Array.from(target)
    st.peak = Float32Array.from(target)
    if (out && out.length === n) {
      out.set(target)
      return out
    }
    return Float32Array.from(target)
  }
  const res = out && out.length === n ? out : new Float32Array(n)
  const kUp = Math.min(Math.max(attack, 0), 1)
  const kDown = Math.min(Math.max(decay, 0), 1)
  const peak = st.peak!
  for (let i = 0; i < n; i++) {
    const t = target[i]
    const prev = st.prev[i]
    // 上升走 attack，下降走 decay
    const k = t > prev ? kUp : kDown
    const v = prev + (t - prev) * (1 - k)
    res[i] = v
    // 频谱帽：保持峰值并缓慢回落
    if (peakFall > 0) {
      if (v > peak[i]) {
        peak[i] = v
      } else {
        peak[i] = Math.max(v, peak[i] - peakFall)
      }
      res[i] = peak[i]
    } else {
      peak[i] = v
    }
    st.prev[i] = res[i]
  }
  return res
}

/** mulberry32：确定性伪随机（粒子/素材抖动等用；seed 不变则序列不变，保证导出一致） */
export function seededRng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 缓动曲线 */
export function easeOutCubic(t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  return 1 - Math.pow(1 - x, 3)
}

export function easeInOutQuad(t: number): number {
  const x = Math.min(Math.max(t, 0), 1)
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** 手动节拍源（0.6.0）：BPM（每分钟拍数）或周期秒 → 拍周期（秒）；返回 null = 节拍关闭。
 * 任意合法正数（不做范围限制，用户可输入远超 30–240 的 BPM；仅校验 >0 且有限）。 */
export function beatPeriod(bpm: number | null, intervalSec: number | null): number | null {
  if (bpm != null && bpm > 0 && Number.isFinite(bpm)) return 60 / bpm
  if (intervalSec != null && intervalSec > 0 && Number.isFinite(intervalSec)) return intervalSec
  return null
}

/** 节拍内相位 0–1（beat 起点=0；period 无效时恒 0）——纯时刻函数 */
export function beatPhase(t: number, period: number): number {
  if (!(period > 0) || !Number.isFinite(period)) return 0
  const x = (t / period) % 1
  return x < 0 ? x + 1 : x
}

/** beat 包络（0–1）：每个 beat 起点 =1，按 tauSec 指数衰减（默认 0.18s）；
 * 确定性（同 t 同值；30/60fps 网格一致）；period 无效 → 恒 0（关闭）。 */
export function beatEnvelope(t: number, period: number, tauSec = 0.18): number {
  if (!(period > 0) || !Number.isFinite(period)) return 0
  const phase = (((t / period) % 1) + 1) % 1
  const tau = Math.max(0.002, tauSec)
  return Math.exp(-((phase * period) / tau))
}

/** 分带能量按时间窗口平滑（确定性采样：5 点窗口均值；30/60fps 同 t 同值）。
 * sample = (t) => 分带能量（预览与导出都传「bandEnergiesAt 包装」——与帧率无关）。 */
export function bandEnergySmoothed(
  sample: (t: number) => BandEnergies,
  t: number,
  band: keyof BandEnergies,
  windowSec = 0.3
): number {
  const steps = 5
  let sum = 0
  for (let i = steps - 1; i >= 0; i--) {
    const tt = Math.max(0, t - (windowSec * (steps - 1 - i)) / (steps - 1))
    sum += sample(tt)[band]
  }
  return sum / steps
}

/** 入场动画类型（0.5.0）：none=无；fade/slide/typewriter/bounce 见 entryProgress 族 */
export type EntryStyle = 'none' | 'fade' | 'slide' | 'typewriter' | 'bounce'

/** 入场进度（含延迟）：t ≤ delay → 0；t ≥ delay+duration → 1；其间线性推进。
 * 纯时刻函数 → 预览 rAF 与导出逐帧同值（30/60fps 一致）。 */
export function entryProgress(t: number, delaySec: number, durationSec: number): number {
  const d = Math.max(0, delaySec)
  const dur = Math.max(0.01, durationSec)
  if (t <= d) return 0
  if (t >= d + dur) return 1
  return (t - d) / dur
}

/** 弹跳过冲（0→1 带轻微回弹；bounce 用）：x=0→0，x=1→≈1 */
export function bounceIn(x: number): number {
  const t = Math.min(Math.max(x, 0), 1)
  return Math.max(0, 1 - Math.exp(-6 * t) * Math.cos(8 * t))
}

/** 片头/片尾时间函数（0.5.0）：黑场alpha 与标题卡 alpha（0–1） */
export interface IntroOutroAlpha {
  /** 片头黑场（1→0）：刚开播全黑（含 lead 前导留白），introFade 秒内淡入画面 */
  intro: number
  /** 标题卡（0–1 边缘淡入淡出）：片头淡入后展示 introTitleCard 秒 */
  titleCard: number
  /** 片尾黑场（0→1）：结束前 outroFade 秒内淡出 */
  outro: number
  /** 前导留白（1→0）：t < leadSec 期间为 1，否则 0 */
  lead: number
}

export interface IntroOutroParam {
  introFade: number
  introTitleCard: number
  outroFade: number
}

/** 片头/片尾状态（纯时刻函数；30/60fps 同 t 同值）。
 * t 为含 lead 前导的总轴（wall clock）；音频相关渐变先换算 at = t - leadSec（lead 期间恒 0）。
 * lead=0 时行为与旧版完全一致；lead>0 时 lead 期间 intro=1（全黑淡入推迟到音频起点）。
 */
export function introOutroAlpha(
  t: number,
  durationSec: number,
  cfg: IntroOutroParam,
  leadSec = 0
): IntroOutroAlpha {
  const lead = Math.max(0, leadSec)
  const dur = Math.max(0, durationSec)
  const at = Math.max(0, t - lead) // 音频时间轴
  const inLead = t < lead
  const introFade = Math.max(0, cfg.introFade)
  const tcLen = Math.max(0, cfg.introTitleCard)
  const tcFade = Math.min(0.4, tcLen / 4)
  const intro = inLead ? 1 : introFade > 0 ? 1 - entryProgress(at, 0, introFade) : 0
  const titleCard =
    inLead || tcLen <= 0
      ? 0
      : Math.min(
          entryProgress(at, introFade, tcFade),
          1 - entryProgress(at, introFade + tcLen - tcFade, tcFade)
        )
  // 片尾淡出位于音频结尾：start = dur - outroFade（总轴 = lead + dur - outroFade → 与无 lead 对齐）
  const outro = cfg.outroFade > 0 ? entryProgress(at, dur - cfg.outroFade, cfg.outroFade) : 0
  return { intro, titleCard, outro, lead: inLead ? 1 : 0 }
}

/** 能量阶跃（踩点闪光）：band 能量在 windowSec 内的上升量 0–1；纯时刻函数、与帧率无关 */
export function energyAttack(
  sample: (t: number) => BandEnergies,
  t: number,
  band: keyof BandEnergies = 'bass',
  windowSec = 0.15
): number {
  const now = sample(t)[band]
  const past = sample(Math.max(0, t - windowSec))[band]
  return Math.min(1, Math.max(0, now - past))
}

/** Ken Burns：慢速缩放平移（0.5.0 用户选定「往复摇摆」）。返回 [scale, dx, dy]（相对画布中心，scale 1=原尺寸）。
 * 往复：偶数周期推入（1→最大），奇数周期拉出（最大→1）；平移 = 方向 × margin × cos(π·x)，
 * 端点与整周期边界处速度为零、位移连续 → 全程无突变、无静止（长歌曲后半程仍运镜）。
 * 保证 |dx|/|dy| ≤ margin（缩放余量）→ 任何时刻画面铺满画布（无露边）。
 * tSec 同值 → 同值（确定性；30/60fps 导出序列一致）。 */
export function kenBurns(
  tSec: number,
  seed: number,
  durationSec: number,
  scaleAmp: number
): [number, number, number] {
  const rnd = seededRng(seed)
  const vx = (rnd() - 0.5) * 2 * (rnd() > 0.5 ? 1 : -1)
  const vy = (rnd() - 0.5) * 2 * (rnd() > 0.5 ? 1 : -1)
  const dur = Math.max(0.001, durationSec)
  const full = tSec / dur
  const cycle = Math.floor(full)
  const x = cycle % 2 === 0 ? full - cycle : 1 - (full - cycle)
  const p = easeInOutQuad(x)
  const s = 1 + scaleAmp * p
  const margin = (s - 1) / 2
  const sweep = Math.cos(Math.PI * x)
  const dx = vx * margin * 0.85 * sweep
  const dy = vy * margin * 0.85 * sweep
  return [s, dx, dy]
}

/** 可视化形态单柱矩形几何（wave 不用此函数——波浪为折线）。
 * @returns {x,y,w,h,rotation} rotation 仅 radial 使用（弧度，Konva 用度数更直观，返回值单位=度）
 */
export interface BarGeometry {
  x: number
  y: number
  w: number
  h: number
  rotation: number
}

export type VizStyle = 'bars' | 'radial' | 'wave' | 'area' | 'dots' | 'flow'

/** 柱形（矩形几何）；radial 为楔形（wedgeGeometry）；wave/area/flow 为连续折线；dots 为点阵 */
export function barGeometry(
  style: VizStyle,
  i: number,
  v: number,
  n: number,
  pxW: number,
  pxH: number,
  barWidthRatio: number,
  _gapRatio: number,
  heightRatio: number
): BarGeometry {
  const v0 = Math.min(Math.max(v, 0), 1)
  const slotW = pxW / n
  const barW = Math.max(1, slotW * barWidthRatio)
  const maxH = pxH * heightRatio
  const h = Math.max(4, v0 * maxH)

  // 柱形（默认）：底部向上（0.3.0 历史几何，保持逐像素一致）
  const w = style === 'area' ? slotW : barW
  const x = style === 'area' ? i * slotW : i * slotW + (slotW - barW) / 2
  return {
    x,
    y: pxH - h,
    w,
    h,
    rotation: 0
  }
}

/** 径向环形楔形（扇形柱）顶点：弧长随半径增长，柱宽（角度）固定 → 疏密均匀。
 * 返回 8 个数值（x, y ×4）：内弧两端 + 外弧两端（闭合多边形）。 */
export function wedgeGeometry(
  i: number,
  v: number,
  n: number,
  pxW: number,
  pxH: number,
  barWidthRatio: number
): number[] {
  const v0 = Math.min(Math.max(v, 0), 1)
  const cx = pxW / 2
  const cy = pxH / 2
  const maxR = Math.min(pxW, pxH) / 2
  const innerR = Math.min(pxW, pxH) * 0.18
  const len = Math.max(4, v0 * (maxR - innerR))
  // 每根柱占角度 = 完整 2π / n；柱宽比例折入角度
  const fullAngle = (2 * Math.PI) / n
  const halfW = (fullAngle * Math.min(Math.max(barWidthRatio, 0.05), 0.95)) / 2
  const a0 = (i / n) * 2 * Math.PI - Math.PI / 2
  const a1 = a0 - halfW
  const a2 = a0 + halfW
  const rOut = innerR + len
  const p = (ang: number, r: number): [number, number] => [
    cx + Math.cos(ang) * r,
    cy + Math.sin(ang) * r
  ]
  const p1 = p(a1, innerR)
  const p2 = p(a2, innerR)
  const p3 = p(a2, rOut)
  const p4 = p(a1, rOut)
  return [p1[0], p1[1], p2[0], p2[1], p3[0], p3[1], p4[0], p4[1]]
}

/** 楔形（radial）每柱一个 Konva.Line（closed）节点，points 为 8 数。 */
export function wedgePointsToLine(points: number[]): number[] {
  // 闭合：Konva Line points 已是 8 数，closed 自动闭合
  return points
}

/** 折线形态：wave=原始曲线；flow=随时间流动的相位叠加。
 * area 已改为"连续柱形"（isLine 移出，走 Rect 无间隙填充）。
 */
export type LineMode = 'wave' | 'flow'

/** 连续折线：每列取 v 的高度；flow 把频谱包络乘以沿 x 前进的细波调制（随 tSec 流动）。
 * 调用方用 phaseShift=0 / PI 各取一套 → 主/副波双层流动视觉。
 * flowWave（0–1）控制波动强度：0=纯频谱（无细波），1=±75% 强波动；默认 0.7。
 * wave 返回单套（与频谱一致）。
 */
export function lineHeights(
  mode: LineMode,
  bars: ArrayLike<number>,
  tSec: number,
  phaseShift = 0,
  flowWave = 0.7
): number[] {
  const n = bars.length
  const out: number[] = new Array(n)
  const amp = Math.min(Math.max(flowWave, 0), 1)
  for (let i = 0; i < n; i++) {
    const v = Math.min(Math.max(bars[i] ?? 0, 0), 1)
    if (mode === 'flow') {
      // 主波=频谱包络（乘法调制，波形轮廓随音乐跳动），细波（±amp×75%）沿 x 前进 → 光带既"跳"又"流"。
      // 安静段落包络=0 → 贴底，音乐一击即起，节奏感与 bars 一致。
      const phase = (i / Math.max(1, n - 1)) * Math.PI * 4 - tSec * 4.5 - phaseShift
      const ripple = 0.5 + 0.5 * Math.sin(phase)
      const ripple2 = 0.5 + 0.5 * Math.sin(phase + Math.PI * 0.5)
      const mix = ripple * 0.75 + ripple2 * 0.25
      out[i] = Math.min(1, v * (1 + amp * (mix * 2 - 1) * 0.75))
    } else {
      out[i] = v
    }
  }
  return out
}
