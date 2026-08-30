import { describe, expect, it } from 'vitest'
import {
  bandEnergySmoothed,
  bandEnergiesFromBars,
  barGeometry,
  beatEnvelope,
  beatEnvelopeCurve,
  beatPhase,
  beatPeriod,
  bounceIn,
  easeOutCubic,
  energyAttack,
  entryProgress,
  introOutroAlpha,
  kenBurns,
  lineHeights,
  seededRng,
  smoothBarsFx,
  wedgeGeometry,
  type BandEnergies,
  type SmoothFxState
} from './fx'

describe('fx 时间函数库', () => {
  it('bandEnergiesFromBars：对数分带 4 段能量计算正确', () => {
    // 模拟 100 根柱：只在前 25%（bass）有能量
    const bars = new Array(100).fill(0).map((_, i) => (i < 25 ? 1 : 0))
    const e = bandEnergiesFromBars(bars)
    expect(e.bass).toBeCloseTo(1, 5)
    expect(e.lowMid).toBe(0)
    expect(e.mid).toBe(0)
    expect(e.treble).toBe(0)
    // 均分能量
    const eq = bandEnergiesFromBars(new Array(100).fill(0.5))
    expect(eq.bass).toBeCloseTo(0.5, 5)
    expect(eq.treble).toBeCloseTo(0.5, 5)
  })

  it('smoothBarsFx：attack/decay 双系数——上升快、下降慢', () => {
    const st: SmoothFxState = { prev: null, peak: null }
    const target = new Float32Array([0, 0])
    smoothBarsFx(st, target, 0.1, 0.9)
    // 突然上升到 1：上升路径 attack=0.1 → 先快升
    const up = smoothBarsFx(st, new Float32Array([1, 1]), 0.1, 0.9)
    expect(up[0]).toBeGreaterThan(0.5)
    // 突然下降到 0：下降路径 decay=0.9 → 慢降
    const down = smoothBarsFx(st, new Float32Array([0, 0]), 0.1, 0.9)
    expect(down[0]).toBeGreaterThan(0.5)
  })

  it('smoothBarsFx：peakFall=0（默认）关闭频谱帽；>0 时峰值保持后缓慢回落', () => {
    const off: SmoothFxState = { prev: null, peak: null }
    smoothBarsFx(off, new Float32Array([0.5]), 0.1, 0.9, 0)
    const r1 = smoothBarsFx(off, new Float32Array([1]), 0.1, 0.9, 0)
    expect(r1[0]).toBeLessThanOrEqual(1)
    // 峰值帽开启：到峰后不立刻跟随回落
    const on: SmoothFxState = { prev: null, peak: null }
    smoothBarsFx(on, new Float32Array([0.2]), 0, 0, 0.02)
    const p1 = smoothBarsFx(on, new Float32Array([1]), 0, 0, 0.02)
    expect(p1[0]).toBeCloseTo(1, 5) // attack=0 立即到峰
    const p2 = smoothBarsFx(on, new Float32Array([0]), 0, 0, 0.02)
    expect(p2[0]).toBeGreaterThanOrEqual(0.98 - 1e-6) // 峰值保持，只回落 0.02
  })

  it('barGeometry：bars 默认形态几何与旧行为一致（底部向上）', () => {
    const g = barGeometry('bars', 2, 0.5, 10, 1000, 200, 0.55, 0.45, 0.92)
    // x = i*slot + (slot-barW)/2；slot=100，barW=55
    expect(g.x).toBeCloseTo(2 * 100 + (100 - 55) / 2, 3)
    expect(g.y).toBeCloseTo(200 - 0.5 * 200 * 0.92, 3)
    expect(g.rotation).toBe(0)
  })

  it('barGeometry：radial 几何在区域中心内侧以内（不越界圆心）', () => {
    const g = barGeometry('radial', 0, 1, 8, 960, 200, 0.55, 0.45, 0.92)
    expect(g.w).toBeGreaterThan(0)
    expect(Number.isFinite(g.x)).toBe(true)
    expect(Number.isFinite(g.y)).toBe(true)
    expect(Number.isFinite(g.rotation)).toBe(true)
  })

  it('barGeometry：radial 环形不越界几何（左上角在区域内）', () => {
    const r = barGeometry('radial', 0, 1, 8, 960, 200, 0.55, 0.45, 0.92)
    expect(Number.isFinite(r.x)).toBe(true)
    expect(Number.isFinite(r.y)).toBe(true)
    expect(Number.isFinite(r.rotation)).toBe(true)
    expect(r.w).toBeGreaterThan(0)
  })

  it('lineHeights：wave=原样；flow=频谱×波动调制（flowWave 可调）', () => {
    const bars = [0.5, 0.5, 0.5]
    expect(lineHeights('wave', bars, 0)).toEqual([0.5, 0.5, 0.5])
    // flowWave=0 → 纯频谱（细波关闭，波形完全跟随音乐）
    const pure = lineHeights('flow', bars, 0, 0, 0)
    for (const v of pure) expect(v).toBeCloseTo(0.5, 6)
    // flowWave=1 → 调制 ∈ [0.25, 1.75]×v
    const full = lineHeights('flow', bars, 0, 0, 1)
    for (const v of full) {
      expect(v).toBeGreaterThanOrEqual(0.5 * 0.25 - 1e-9)
      expect(v).toBeLessThanOrEqual(0.5 * 1.75 + 1e-9)
    }
    // 波动越强，偏离纯频谱越大（滑块生效）
    const ampA = lineHeights('flow', bars, 0, 0, 0.3)
    const ampB = lineHeights('flow', bars, 0, 0, 1)
    const dev = (arr: number[]): number => arr.reduce((s, v) => s + Math.abs(v - 0.5), 0)
    expect(dev(ampB)).toBeGreaterThan(dev(ampA))
    // 频谱成比例：v 翻倍 → 包络也翻倍（细波不变；0.4×1.375 不触顶）
    const soft = lineHeights('flow', [0.2, 0.2, 0.2], 0, 0, 0.5)
    const loud = lineHeights('flow', [0.4, 0.4, 0.4], 0, 0, 0.5)
    for (let i = 0; i < loud.length; i++) {
      expect(loud[i]).toBeCloseTo(soft[i] * 2, 6)
    }
    // 安静段贴底（波形随音乐消失）
    for (const v of lineHeights('flow', [0, 0, 0], 0, 0, 1)) expect(v).toBe(0)
    // 时间推进 → 相位变化（光带流动）
    expect(lineHeights('flow', bars, 0)).not.toEqual(lineHeights('flow', bars, 1.0))
  })

  it('bandEnergySmoothed：窗口均值确定性——同 t 同值、连续、帧率无关', () => {
    const sample = (tt: number): BandEnergies => ({
      bass: 0.4 * tt,
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    // 窗口 [t-0.3, t] 内 5 点均值 = 中点值（线性函数）
    expect(bandEnergySmoothed(sample, 1.5, 'bass', 0.3)).toBeCloseTo(0.4 * 1.35, 5)
    // 确定性/帧率无关：30fps 与 60fps 网格在同一时刻 t 上调用得到完全相同结果
    const a = bandEnergySmoothed(sample, 1.23, 'bass', 0.3)
    const b = bandEnergySmoothed(sample, 1.23, 'bass', 0.3)
    expect(a).toBe(b)
    // 连续性：t 微小变化 → 值微小变化
    const v1 = bandEnergySmoothed(sample, 1.5, 'bass', 0.3)
    const v2 = bandEnergySmoothed(sample, 1.51, 'bass', 0.3)
    expect(Math.abs(v2 - v1)).toBeLessThan(0.05)
    // t<window 截断到 0（不越界）
    expect(bandEnergySmoothed(sample, 0.1, 'bass', 0.3)).toBeGreaterThanOrEqual(0)
  })

  it('energyAttack：阶跃上升>0、平稳=0、下降=0、上限 1', () => {
    const step = (tt: number): BandEnergies => ({
      bass: tt >= 1 ? 1 : 0,
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    // 刚跨过阶跃（now=1.0>past=0）→ 触发 1
    expect(energyAttack(step, 1.05, 'bass', 0.15)).toBeCloseTo(1, 6)
    // 尚未到达阶跃 → 0；已稳定在 1 → 0（无新阶跃）
    expect(energyAttack(step, 0.95, 'bass', 0.15)).toBe(0)
    expect(energyAttack(step, 2.0, 'bass', 0.15)).toBe(0)
    // 平稳高能量（鼓点长音，忽略时刻）→ 0（不会假触发）
    const flat = (): BandEnergies => ({ bass: 0.8, lowMid: 0, mid: 0, treble: 0 })
    expect(energyAttack(flat, 1.0, 'bass', 0.15)).toBe(0)
    // 线性上升：攻击量 = 斜率×窗口（0.15s × 1.0/s）
    const ramp = (tt: number): BandEnergies => ({
      bass: Math.min(1, tt),
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    expect(energyAttack(ramp, 0.6, 'bass', 0.15)).toBeCloseTo(0.15, 6)
    // 钳制上限 1
    const jump = (tt: number): BandEnergies => ({
      bass: tt > 0 ? 1 : 0,
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    expect(energyAttack(jump, 0.1, 'bass', 0.15)).toBe(1)
  })

  it('entryProgress：含延迟的入场进度——未开始 0、完成 1、区间线性、帧率无关', () => {
    expect(entryProgress(0.5, 1, 1.2)).toBe(0)
    expect(entryProgress(2.2, 1, 1.2)).toBe(1)
    expect(entryProgress(1.6, 1, 1.2)).toBeCloseTo(0.5, 6)
    // 同 t 同值（30/60fps 序列一致的根源）
    expect(entryProgress(1.234, 0.5, 2.5)).toBe(entryProgress(1.234, 0.5, 2.5))
    // 参数钳制：负延迟→0、零时长→视为 0.01
    expect(entryProgress(0.1, -1, 1)).toBeGreaterThan(0)
  })

  it('fps 序列一致：30fps 与 60fps 网格在相同 tSec 上输出完全相同（动效时间函数）', () => {
    const cfg = { introFade: 1.5, introTitleCard: 2, outroFade: 1 }
    const energy = (tt: number): BandEnergies => ({
      bass: Math.max(0, Math.sin(tt * 3)) * Math.min(1, tt),
      lowMid: 0,
      mid: 0,
      treble: 0
    })
    const at = (tSec: number): number[] => [
      entryProgress(tSec, 0.4, 1.2),
      introOutroAlpha(tSec, 10, cfg).intro,
      introOutroAlpha(tSec, 10, cfg).titleCard,
      introOutroAlpha(tSec, 10, cfg).outro,
      bandEnergySmoothed(energy, tSec, 'bass', 0.3),
      energyAttack(energy, tSec, 'bass', 0.15),
      bounceIn((tSec * 7) % 1)
    ]
    // 30fps 网格 (3.33ms) 与 60fps 网格：共享 tSec（如 1.2s、1.5s、4.5333s）全部相等
    for (const t of [0, 0.2, 1.2, 1.5, 4.533333, 9.0]) {
      expect(at(t)).toEqual(at(t))
    }
    // 时间推进 → 至少一个成分变化（动效确实随时间演化）
    expect(at(0.2)).not.toEqual(at(0.8))
  })

  it('bounceIn：端点 0→1，中间超冲（先超后回弹）', () => {
    expect(bounceIn(0)).toBeCloseTo(0, 6)
    expect(bounceIn(1)).toBeCloseTo(1, 1)
    let max = 0
    for (let i = 0; i <= 20; i++) max = Math.max(max, bounceIn(i / 20))
    expect(max).toBeGreaterThan(1.05) // 有回弹超冲
  })

  it('introOutroAlpha：片头黑场 1→0、标题卡边缘淡入淡出、片尾 0→1（纯时刻函数）', () => {
    const cfg = { introFade: 1, introTitleCard: 2, outroFade: 1 }
    // t=0：全黑；t=1（片头结束）：黑场消失
    expect(introOutroAlpha(0, 10, cfg).intro).toBeCloseTo(1, 6)
    expect(introOutroAlpha(1, 10, cfg).intro).toBeCloseTo(0, 6)
    // 标题卡窗口 [1, 3]：窗口内非 0、超出为 0、边缘渐入
    expect(introOutroAlpha(0, 10, cfg).titleCard).toBe(0)
    expect(introOutroAlpha(2, 10, cfg).titleCard).toBeCloseTo(1, 2)
    expect(introOutroAlpha(4, 10, cfg).titleCard).toBe(0)
    // 片尾：t=9 尚未淡出；t=10 全黑
    expect(introOutroAlpha(8.5, 10, cfg).outro).toBe(0)
    expect(introOutroAlpha(10, 10, cfg).outro).toBeCloseTo(1, 6)
    // 全关 → 恒 0
    const off = introOutroAlpha(3, 10, { introFade: 0, introTitleCard: 0, outroFade: 0 })
    expect(off.intro).toBe(0)
    expect(off.titleCard).toBe(0)
    expect(off.outro).toBe(0)
    expect(off.lead).toBe(0)
    // 确定性
    expect(introOutroAlpha(1.234, 10, cfg)).toEqual(introOutroAlpha(1.234, 10, cfg))
  })

  it('introOutroAlpha leadSec：lead 期间全黑，音频轴渐变与无 lead 结果逐点对齐（0.7.0）', () => {
    const cfg = { introFade: 1, introTitleCard: 2, outroFade: 1 }
    const lead = 2
    // lead 期间：lead=1、intro=1（全黑）、无标题卡
    expect(introOutroAlpha(0, 10, cfg, lead).lead).toBeCloseTo(1, 6)
    expect(introOutroAlpha(1.999, 10, cfg, lead).lead).toBeCloseTo(1, 6)
    expect(introOutroAlpha(1, 10, cfg, lead).intro).toBeCloseTo(1, 6)
    expect(introOutroAlpha(1, 10, cfg, lead).titleCard).toBe(0)
    // 默认 lead=0 → lead 字段恒 0（旧行为完全不变）
    expect(introOutroAlpha(1, 10, cfg).lead).toBe(0)
    // 音频轴对齐：总轴 t = lead + at 的渐变（intro/titleCard/outro）= 无 lead 时 t = at
    for (const at of [0, 1, 2, 3, 4, 8.5, 9, 10, 11]) {
      const withLead = introOutroAlpha(lead + at, 10, cfg, lead)
      const plain = introOutroAlpha(at, 10, cfg)
      expect(withLead.intro).toBeCloseTo(plain.intro, 6)
      expect(withLead.titleCard).toBeCloseTo(plain.titleCard, 6)
      expect(withLead.outro).toBeCloseTo(plain.outro, 6)
    }
    // 片尾黑场推迟到音频结尾之后的总轴时刻：总轴 11（= lead+9）尚未淡出，12（= lead+10）全黑
    expect(introOutroAlpha(lead + 8.5, 10, cfg, lead).outro).toBe(0)
    expect(introOutroAlpha(lead + 10, 10, cfg, lead).outro).toBeCloseTo(1, 6)
    // lead 结束瞬间（t == lead）：不再是 lead 黑场，但 intro 从 1 开始淡入
    expect(introOutroAlpha(lead, 10, cfg, lead).lead).toBe(0)
    expect(introOutroAlpha(lead, 10, cfg, lead).intro).toBeCloseTo(1, 6)
  })

  it('手动节拍源：beatPeriod/beatPhase/beatEnvelope——BPM 优先、自由值、确定性、包络衰减', () => {
    // BPM 优先（即使 interval 也给了）；合法正数不限范围（500 BPM 也不拒绝）
    expect(beatPeriod(120, 1)).toBeCloseTo(0.5, 9)
    expect(beatPeriod(500, 3)).toBeCloseTo(0.12, 9)
    expect(beatPeriod(0, 2)).toBeCloseTo(2, 9) // 0/无效 BPM → 回退周期
    expect(beatPeriod(null, null)).toBeNull()
    expect(beatPeriod(-10, null)).toBeNull()
    // 相位：beat 起点 0；半周期 0.5；确定性
    const p = 0.5
    expect(beatPhase(0, p)).toBeCloseTo(0, 9)
    expect(beatPhase(0.25, p)).toBeCloseTo(0.5, 9)
    expect(beatPhase(1.0, p)).toBeCloseTo(0, 9) // 整拍回零
    expect(beatPhase(0.1234, p)).toBe(beatPhase(0.1234, p))
    // 包络：beat 起点=1 → 衰减；下一 beat 前接近 0
    expect(beatEnvelope(0, p, 0.18)).toBeCloseTo(1, 9)
    expect(beatEnvelope(0.05, p, 0.18)).toBeLessThan(1)
    expect(beatEnvelope(0.05, p, 0.18)).toBeGreaterThan(0.4)
    expect(beatEnvelope(0.49, p, 0.18)).toBeLessThan(0.1) // 接近下一拍时基本衰减完
    expect(beatEnvelope(0, p, 0.18)).toBe(beatEnvelope(0, p, 0.18))
    // 关闭态：period 无效 → 包络 0
    expect(beatEnvelope(1, 0, 0.18)).toBe(0)
    expect(beatPhase(1, 0)).toBe(0)
    // 变 BPM 包络：拍相位 = frac(蓄积拍数)——常量速率下与 beatEnvelope 等价
    const beatsAt = (u: number): number => u / 0.5 // 周期 0.5s
    expect(beatEnvelopeCurve(0, 0.5, 0.18, beatsAt)).toBeCloseTo(beatEnvelope(0, 0.5, 0.18), 9)
    expect(beatEnvelopeCurve(0.25, 0.5, 0.18, beatsAt)).toBeCloseTo(
      beatEnvelope(0.25, 0.5, 0.18),
      9
    )
    expect(beatEnvelopeCurve(0.5, 0.5, 0.18, beatsAt)).toBeCloseTo(beatEnvelope(0.5, 0.5, 0.18), 9)
    expect(beatEnvelopeCurve(1, 0, 0.18, beatsAt)).toBe(0) // period 无效 → 0
  })

  it('kenBurns：往复摇摆——周期边界连续无突变、推拉对称、无露边', () => {
    const seed = 42
    const amp = 0.1
    const dur = 4
    // 往复：半周期处最大；四分之一周期时推入 < 四分之三（推入/拉出对称）
    const s25 = kenBurns(dur * 0.25, seed, dur, amp)[0]
    const s75 = kenBurns(dur * 0.75, seed, dur, amp)[0]
    const s125 = kenBurns(dur * 1.25, seed, dur, amp)[0]
    const s175 = kenBurns(dur * 1.75, seed, dur, amp)[0]
    expect(s25).toBeLessThan(s75)
    expect(s125).toBeGreaterThan(s175) // 第二周期方向相反
    expect(s75).toBeCloseTo(s125, 9) // 每周期都到达同样最大缩放
    // 整周期边界：前后 1ms 的 scale/位移连续（无突变）
    const a0 = kenBurns(dur, seed, dur, amp)
    const a1 = kenBurns(dur + 0.001, seed, dur, amp)
    expect(Math.abs(a0[0] - a1[0])).toBeLessThan(0.002)
    expect(Math.abs(a0[1] - a1[1])).toBeLessThan(0.002)
    expect(Math.abs(a0[2] - a1[2])).toBeLessThan(0.002)
    // 无露边：|dx| ≤ (s−1)/2 × 1（含 0.85 系数），任意时刻
    for (const t of [0, 0.5, 1, 2.2, 4.33, 9.9]) {
      const [s, dx, dy] = kenBurns(t, seed, dur, amp)
      expect(Math.abs(dx)).toBeLessThanOrEqual((s - 1) / 2 + 1e-9)
      expect(Math.abs(dy)).toBeLessThanOrEqual((s - 1) / 2 + 1e-9)
      expect(s).toBeGreaterThanOrEqual(1)
    }
    // 起始=原尺寸（无跳变入场）
    expect(kenBurns(0, seed, dur, amp)[0]).toBeCloseTo(1, 9)
  })

  it('wedgeGeometry：radial 楔形 4 顶点 8 数值，弧长随半径增长均匀', () => {
    const pts = wedgeGeometry(0, 1, 16, 960, 200, 0.55)
    expect(pts).toHaveLength(8)
    expect(Number.isFinite(pts[0])).toBe(true)
    // 顶点顺序：内弧两端 → 外弧两端；外弧点离中心更远
    const cx = 480
    const cy = 100
    const rIn1 = Math.hypot(pts[0] - cx, pts[1] - cy)
    const rOut3 = Math.hypot(pts[4] - cx, pts[5] - cy)
    expect(rOut3).toBeGreaterThan(rIn1)
    // v=0 时仍有最小长度（>0）
    const z = wedgeGeometry(0, 0, 16, 960, 200, 0.55)
    for (const v of z) expect(Number.isFinite(v)).toBe(true)
  })

  it('seededRng：同种子同序列，不同种子不同', () => {
    const a = seededRng(42)
    const b = seededRng(42)
    expect(a()).toBe(b())
    const c = seededRng(43)
    expect(a()).not.toBe(c())
  })

  it('easeOutCubic：端点与单调性', () => {
    expect(easeOutCubic(0)).toBe(0)
    expect(easeOutCubic(1)).toBeCloseTo(1, 6)
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5)
    expect(easeOutCubic(0.5)).toBeLessThan(1)
  })
})
