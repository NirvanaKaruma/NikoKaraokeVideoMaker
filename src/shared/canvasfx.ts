/**
 * CanvasFX 管线（0.5.0 全局后期）——纯函数 (ctx, tSec, opts, w, h)：
 * 预览 overlay 与导出 compose 共用同一实现（核心约束 A）。
 * 全部参数 0 = 无后期（与 0.4.0 输出完全一致）。
 * 确定性：所有随机成分都是 (t, seed) 的纯函数（mulberry32 / 时刻哈希），
 * 同一 tSec 无论 30fps 还是 60fps 网格都得到相同画面。
 */
import { beatEnvelope, energyAttack, seededRng, type BandEnergies } from './fx'

/** 颗粒纹理种子（静态纹理只生成一次） */
const GRAIN_TEX_SEED = 424242
/** 颗粒位置在 1/24 秒网格上跳变（与帧率无关：同 t 同偏移） */
const GRAIN_TICK = 24

/** 颗粒偏移（t 的纯函数）→ [dx01, dy01]，范围 [0,1) */
export function grainOffset(t: number): [number, number] {
  const x = Math.max(0, Math.floor(t * GRAIN_TICK))
  const r = seededRng(GRAIN_TEX_SEED + x * 7919)
  return [r(), r()]
}

/** 踩点闪光强度（纯函数）：bass 能量阶跃 → 0–1；无采样器或强度 0 → 0 */
export function flashIntensity(
  energy: ((t: number) => BandEnergies) | undefined,
  t: number,
  strength: number
): number {
  if (!energy || strength <= 0) return 0
  return Math.min(1, energyAttack(energy, t, 'bass', 0.15) * strength * 1.2)
}

/** 绘制全部叠加（按 暗角→颗粒→扫描线→闪光→漏光 顺序；参数 0 自动跳过） */
export interface CanvasFxDrawOpts {
  /** 视觉时间（秒，已含 offset） */
  t: number
  vignette: number
  grain: number
  scanline: number
  beatFlash: number
  lightLeak: number
  /** 分带能量采样器（踩点闪光用；导出/预览都传 bandEnergiesAt 包装） */
  energy?: (t: number) => BandEnergies
  /** 手动节拍源（0.6.0）：>0 时踩点闪光优先按 beat 包络（替代能量阶跃）；null/0 = 能量阶跃 */
  beatPeriodSec?: number | null
  /** 漏光素材（内置生成一次并复用）；null = 首次调用时惰性生成 */
  leakSprite?: HTMLCanvasElement | null
}

const FLASH_COLOR = 'rgba(255,255,255,'

/** 漏光素材：暖色斜向光斑（程序化生成，一次即可复用） */
let cachedLeakSprite: HTMLCanvasElement | null = null

export function getLeakSprite(): HTMLCanvasElement {
  if (cachedLeakSprite) return cachedLeakSprite
  const c = document.createElement('canvas')
  c.width = 1024
  c.height = 1024
  const ctx = c.getContext('2d')
  if (ctx) {
    ctx.clearRect(0, 0, 1024, 1024)
    const blobs: Array<[number, number, number, string]> = [
      [820, 160, 420, 'rgba(255,236,190,0.5)'],
      [910, 300, 260, 'rgba(255,206,140,0.45)'],
      [640, 90, 300, 'rgba(255,244,214,0.32)'],
      [900, 500, 200, 'rgba(255,180,120,0.3)']
    ]
    for (const [x, y, r, color] of blobs) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r)
      g.addColorStop(0, color)
      g.addColorStop(1, 'rgba(255,220,160,0)')
      ctx.fillStyle = g
      ctx.fillRect(0, 0, 1024, 1024)
    }
  }
  cachedLeakSprite = c
  return c
}

/** 颗粒纹理：256×256 灰度噪点（一次生成，绘制时按 t 平移） */
let cachedGrainTex: HTMLCanvasElement | null = null

export function getGrainTex(): HTMLCanvasElement {
  if (cachedGrainTex) return cachedGrainTex
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 256
  const ctx = c.getContext('2d')
  if (ctx) {
    const img = ctx.createImageData(256, 256)
    const r = seededRng(GRAIN_TEX_SEED)
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.floor(r() * 255)
      img.data[i] = v
      img.data[i + 1] = v
      img.data[i + 2] = v
      img.data[i + 3] = 255
    }
    ctx.putImageData(img, 0, 0)
  }
  cachedGrainTex = c
  return c
}

export function drawCanvasFx(
  ctx: CanvasRenderingContext2D,
  o: CanvasFxDrawOpts,
  w: number,
  h: number
): void {
  const prevAlpha = ctx.globalAlpha
  const prevComposite = ctx.globalCompositeOperation

  // 1) 暗角：径向渐变（中心透明 → 边缘黑）
  if (o.vignette > 0) {
    const r = Math.hypot(w, h) / 2
    const g = ctx.createRadialGradient(w / 2, h / 2, r * 0.35, w / 2, h / 2, r)
    g.addColorStop(0, 'rgba(0,0,0,0)')
    g.addColorStop(1, `rgba(0,0,0,${Math.min(0.9, o.vignette * 0.85)})`)
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
  }

  // 2) 胶片颗粒：噪点纹理叠加（overlay 混合，位置按 t 平移）
  if (o.grain > 0) {
    const tex = getGrainTex()
    const [ox, oy] = grainOffset(o.t)
    ctx.globalAlpha = Math.min(0.35, o.grain * 0.3)
    ctx.globalCompositeOperation = 'overlay'
    const offX = Math.floor(ox * w) - 128
    const offY = Math.floor(oy * h) - 128
    for (let y = offY - 256; y < h; y += 256) {
      for (let x = offX - 256; x < w; x += 256) {
        ctx.drawImage(tex, x, y)
      }
    }
    ctx.globalCompositeOperation = prevComposite
    ctx.globalAlpha = prevAlpha
  }

  // 3) 扫描线：每 4px 一条半透明横线（静态，轻量）
  if (o.scanline > 0) {
    ctx.fillStyle = `rgba(0,0,0,${Math.min(0.5, o.scanline * 0.45)})`
    for (let y = 0; y < h; y += 4) {
      ctx.fillRect(0, y, w, 1)
    }
  }

  // 4) 踩点闪光：手动节拍源优先（beat 包络），否则 bass 能量阶跃 → 白闪（全屏叠白）
  const bp = o.beatPeriodSec
  const fi =
    bp != null && bp > 0
      ? Math.min(1, beatEnvelope(o.t, bp) * o.beatFlash * 1.3)
      : flashIntensity(o.energy, o.t, o.beatFlash)
  if (fi > 0.01) {
    ctx.fillStyle = FLASH_COLOR + (fi * 0.55).toFixed(3) + ')'
    ctx.fillRect(0, 0, w, h)
  }

  // 5) 光斑/漏光：暖色斜光（screen 混合；位置/角度随 t 缓慢漂移，确定性）
  if (o.lightLeak > 0) {
    const sprite = o.leakSprite ?? getLeakSprite()
    ctx.globalAlpha = Math.min(0.85, o.lightLeak)
    ctx.globalCompositeOperation = 'screen'
    const drift = Math.sin(o.t * 0.08) * 0.12
    const size = Math.max(w, h) * 1.1
    const cx = w * (0.55 + drift)
    const cy = h * (0.42 + Math.cos(o.t * 0.06) * 0.1)
    ctx.save()
    ctx.translate(cx, cy)
    ctx.rotate(-0.32 + Math.sin(o.t * 0.05) * 0.08)
    ctx.drawImage(sprite, -size / 2, -size / 2, size, size)
    ctx.restore()
    ctx.globalCompositeOperation = prevComposite
    ctx.globalAlpha = prevAlpha
  }
}
