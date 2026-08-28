/**
 * 粒子系统（0.6.0）——纯函数 (t, preset, density, boost, w, h)：
 * 确定性：每个粒子由固定种子（mulberry32）生成独立循环轨迹（周期 6–12s、错开起点），
 * 位置/透明度都是 t 的纯函数 → 30/60fps 同 t 同位置（种子=时间，导出序列一致）。
 * 预览 overlay 与导出 compose 共用（核心约束 A）。
 */
import { seededRng } from './fx'
import type { ParticlePreset } from './layout'

export interface Particle {
  x: number
  y: number
  r: number
  alpha: number
  color: string
  /** true = 画成空心气泡（stroke） */
  hollow: boolean
}

interface PresetMeta {
  colors: string[]
  /** 满密度时的粒子数 */
  base: number
  /** 大小区间 */
  rmin: number
  rmax: number
  /** 横向摆动幅度（×w） */
  sway: number
}

const PRESET_SEED: Record<ParticlePreset, number> = {
  snow: 11,
  sakura: 22,
  star: 33,
  bubble: 44
}

const META: Record<ParticlePreset, PresetMeta> = {
  snow: { colors: ['#ffffff'], base: 60, rmin: 1.2, rmax: 3.2, sway: 0.04 },
  sakura: {
    colors: ['#ffb7c5', '#ff9eb5', '#ffc9d8', '#ffd3e0'],
    base: 46,
    rmin: 2.2,
    rmax: 4.6,
    sway: 0.09
  },
  star: { colors: ['#fff7d6', '#ffffff', '#ffe9a8'], base: 70, rmin: 0.8, rmax: 2.0, sway: 0 },
  bubble: { colors: ['rgba(255,255,255,0.55)'], base: 34, rmin: 3, rmax: 8.5, sway: 0.05 }
}

/** 粒子快照（t 的纯函数）。boost：beat 爆发强度（0–1+，增大透明度/尺寸）。
 * 密度 0 → 空数组（关闭）。 */
export function particlesAt(
  t: number,
  preset: ParticlePreset,
  density: number,
  boost: number,
  w: number,
  h: number
): Particle[] {
  if (!(density > 0) || w <= 0 || h <= 0) return []
  const meta = META[preset]
  const n = Math.round(meta.base * Math.min(1, density))
  const out: Particle[] = []
  const boostClamped = Math.min(2, Math.max(0, boost))
  for (let i = 0; i < n; i++) {
    const rnd = seededRng(i * 733 + PRESET_SEED[preset])
    const x0 = rnd() * w
    const y0 = rnd() * h
    const r = meta.rmin + rnd() * (meta.rmax - meta.rmin)
    const cycle = 6 + rnd() * 6
    const phase = rnd() * cycle
    const swayPhase = rnd() * Math.PI * 2
    const color = meta.colors[i % meta.colors.length]
    if (preset === 'star') {
      // 星空：固定位置闪烁（纯 t 函数）
      const tw = 0.5 + 0.5 * Math.sin(t * 2.4 + swayPhase)
      out.push({
        x: x0,
        y: y0,
        r,
        alpha: (0.25 + 0.75 * tw) * (1 + boostClamped * 0.4),
        color,
        hollow: false
      })
      continue
    }
    const tt = ((t + phase) % cycle) / cycle
    const fade = Math.sin(Math.PI * tt) // 0→1→0 出入场
    const alpha = fade * (0.55 + 0.45 * (1 + boostClamped * 0.5))
    if (alpha <= 0.01) continue
    const sway = Math.sin(tt * Math.PI * 4 + swayPhase) * meta.sway * w
    if (preset === 'bubble') {
      const y = h + 20 - tt * (h + 40)
      out.push({ x: x0 + sway, y, r: r * (1 + boostClamped * 0.15), alpha, color, hollow: true })
    } else {
      const y = -20 + tt * (h + 40)
      out.push({ x: x0 + sway, y, r: r * (1 + boostClamped * 0.15), alpha, color, hollow: false })
    }
  }
  return out
}

/** 绘制粒子到 2D ctx（预览 overlay / 导出 compose 共用） */
export function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  const prevAlpha = ctx.globalAlpha
  for (const p of particles) {
    ctx.globalAlpha = Math.min(1, p.alpha)
    ctx.beginPath()
    ctx.arc(p.x, p.y, Math.max(0.3, p.r), 0, Math.PI * 2)
    if (p.hollow) {
      ctx.strokeStyle = p.color
      ctx.lineWidth = 1.4
      ctx.stroke()
    } else {
      ctx.fillStyle = p.color
      ctx.fill()
    }
  }
  ctx.globalAlpha = prevAlpha
}
