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

/** Ken Burns：慢速缩放平移。返回 [scale, dx, dy]（相对画布中心，scale 1=原尺寸） */
export function kenBurns(
  tSec: number,
  seed: number,
  durationSec: number,
  scaleAmp: number
): [number, number, number] {
  const rnd = seededRng(seed)
  const zx = (rnd() - 0.5) * 2
  const zy = (rnd() - 0.5) * 2
  const dirX = rnd() > 0.5 ? 1 : -1
  const dirY = rnd() > 0.5 ? 1 : -1
  const p = tSec / Math.max(durationSec, 0.001)
  const s = 1 + scaleAmp * easeInOutQuad(p)
  const dx = zx * scaleAmp * dirX * s
  const dy = zy * scaleAmp * dirY * s
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

/** 连续折线：每列取 v 的高度，追加"流动"相位偏移（flow 用 tSec 推动）。
 * 返回与 bars 等长的 0–1 高度数组。
 */
export function lineHeights(mode: LineMode, bars: ArrayLike<number>, tSec: number): number[] {
  const n = bars.length
  const out: number[] = new Array(n)
  for (let i = 0; i < n; i++) {
    const v = Math.min(Math.max(bars[i] ?? 0, 0), 1)
    if (mode === 'flow') {
      // 流动感：相邻柱相位差 → 正弦扰动叠加缓慢移动
      const phase = (i / Math.max(1, n - 1)) * Math.PI * 2 - tSec * 2.4
      const ripple = Math.max(0, Math.sin(phase)) * 0.35
      out[i] = Math.min(1, v * 0.75 + ripple)
    } else {
      out[i] = v
    }
  }
  return out
}
