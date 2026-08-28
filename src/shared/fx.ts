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

export type VizStyle = 'bars' | 'mirror' | 'center' | 'radial' | 'wave' | 'area' | 'dots'

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

  switch (style) {
    case 'bars':
    case 'area':
    case 'dots': {
      // 柱形（默认）：底部向上 / area 复用柱形（渐变填充由颜色层处理）/ dots 高量化
      const hh = style === 'dots' ? Math.max(4, Math.ceil(v0 * 12) * (maxH / 12)) : h
      return {
        x: i * slotW + (slotW - barW) / 2,
        y: pxH - hh,
        w: barW,
        h: hh,
        rotation: 0
      }
    }
    case 'mirror': {
      // 左右镜像：左半向上、右半向下（以中线为对称轴）
      const half = Math.round(n / 2)
      if (i < half) {
        return { x: i * slotW + (slotW - barW) / 2, y: pxH - h, w: barW, h, rotation: 0 }
      }
      return { x: i * slotW + (slotW - barW) / 2, y: 0, w: barW, h, rotation: 0 }
    }
    case 'center': {
      // 中心对称：以竖直中线为轴，左半向左伸展、右半向右伸展（水平条）
      const half = Math.round(n / 2)
      const cx = pxW / 2
      const len = Math.max(4, v0 * (pxW / 2) * heightRatio)
      if (i < half) {
        const y = (i / Math.max(1, half)) * pxH + (pxH / half - Math.max(1, barW)) / 2
        return { x: cx - len, y, w: len, h: Math.max(1, barW), rotation: 0 }
      }
      const j = i - half
      const y = (j / Math.max(1, n - half)) * pxH + (pxH / (n - half) - Math.max(1, barW)) / 2
      return { x: cx, y, w: len, h: Math.max(1, barW), rotation: 0 }
    }
    case 'radial': {
      // 径向环形：柱绕区域中心放射（柱长=len，柱厚=barW）。
      // Konva Rect.x/y 为左上角、rotation 绕中心——先算中心再回推左上角。
      const cx = pxW / 2
      const cy = pxH / 2
      const angle = (i / n) * 360 - 90
      const innerR = Math.min(pxW, pxH) * 0.18
      const len = Math.max(4, v0 * (Math.min(pxW, pxH) / 2 - innerR))
      const rad = (angle * Math.PI) / 180
      const midR = innerR + len / 2
      const midX = cx + Math.cos(rad) * midR
      const midY = cy + Math.sin(rad) * midR
      // 中心点在柱体长轴上且距中心内端 len/2：矩形中心 = midX/midY
      return {
        x: midX - len / 2,
        y: midY - barW / 2,
        w: len,
        h: barW,
        rotation: angle
      }
    }
    default:
      return { x: 0, y: pxH - h, w: barW, h, rotation: 0 }
  }
}
