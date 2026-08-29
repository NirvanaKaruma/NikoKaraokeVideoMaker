import { describe, expect, it } from 'vitest'
import { SNAP_THRESHOLD, snapPosition, type SnapRect } from './snap'

const canvas = { width: 1920, height: 1080 }

describe('snapPosition（0.9.0 吸附对齐线）', () => {
  it('画布左边缘吸附：拖到 x≈0 → 吸到 0，出现竖引导线', () => {
    const r = snapPosition({ x: 4, y: 100, w: 200, h: 100 }, [], canvas)
    expect(r.x).toBe(0)
    expect(r.lines).toEqual([{ axis: 'v', pos: 0 }])
  })

  it('画布水平/垂直中心吸附（二轴同时）', () => {
    const r = snapPosition({ x: 856, y: 486, w: 200, h: 100 }, [], canvas)
    // 中心 960/540：left 856 距 960 差 104；right 1056 差 96；center 956 距 960 差 4 → 位移 +4 → x=860
    expect(r.x).toBe(860)
    expect(r.y).toBe(490)
    expect(r.lines).toContainEqual({ axis: 'v', pos: 960 })
    expect(r.lines).toContainEqual({ axis: 'h', pos: 540 })
  })

  it('元素间对齐：拖动矩形左缘接近目标右缘 → 吸附并出线；阈值外不误吸附', () => {
    const target: SnapRect = { x: 500, y: 300, w: 300, h: 200 }
    const near = snapPosition({ x: 806, y: 100, w: 200, h: 100 }, [target], canvas)
    expect(near.x).toBe(800) // target 右 800 —— 移动 806→800（左缘锚点 806 距 800 差 6 ≤ 8）
    expect(near.lines).toContainEqual({ axis: 'v', pos: 800 })
    // 阈值外（14 > 8）：不吸附
    const far = snapPosition({ x: 814, y: 100, w: 200, h: 100 }, [target], canvas)
    expect(far.x).toBe(814)
    expect(far.lines).toHaveLength(0)
  })

  it('中线对齐与确定性：目标中线命中 + 同输入同输出', () => {
    const target: SnapRect = { x: 0, y: 0, w: 400, h: 200 }
    const a = snapPosition({ x: 189, y: 40, w: 22, h: 20 }, [target], canvas)
    // 拖动中心 200 距目标中线 200 差 0 → 不动，出竖线
    expect(a.x).toBe(189)
    expect(a.lines).toContainEqual({ axis: 'v', pos: 200 })
    const b = snapPosition({ x: 189, y: 40, w: 22, h: 20 }, [target], canvas)
    expect(a).toEqual(b)
  })

  it('阈值外（无候选）完全不动且无线；多候选取最小位移', () => {
    const r = snapPosition({ x: 100, y: 100, w: 200, h: 100 }, [], canvas)
    expect(r).toEqual({ x: 100, y: 100, lines: [] })
    // 多候选：x 距 0 差 3、距 960 差 5 → 取 0（差 3 更小）
    const m = snapPosition({ x: 3, y: 100, w: 200, h: 100 }, [], canvas)
    expect(m.x).toBe(0)
    expect(m.lines).toEqual([{ axis: 'v', pos: 0 }])
    expect(SNAP_THRESHOLD).toBe(8)
  })
})
