import { describe, expect, it } from 'vitest'
import {
  clampSegmentsToDuration,
  getByPath,
  hasTimeline,
  interpolateValue,
  lerpLayouts,
  resolveLayoutAt,
  segmentAt,
  segmentOverlaps,
  setByPath,
  trackValueAt,
  type TimelineDocument,
  type TimelineSegment
} from './timeline'
import { DEFAULT_LAYOUT } from './layout'

const seg = (patch: Partial<TimelineSegment> = {}): TimelineSegment => ({
  id: 's1',
  startSec: 0,
  endSec: 10,
  layout: null,
  keyframes: [],
  ...patch
})

const doc = (segments: TimelineSegment[]): TimelineDocument => ({ segments })

describe('timeline 时间轴与插值引擎（1.0.0，纯函数）', () => {
  it('setByPath/getByPath：点路径导航与写入（中间节点自动创建）', () => {
    const o: Record<string, unknown> = { a: { b: 1 } }
    expect(getByPath(o, 'a.b')).toBe(1)
    expect(getByPath(o, 'a.c')).toBeUndefined()
    expect(getByPath(o, 'nope.x')).toBeUndefined()
    setByPath(o, 'a.b', 2)
    setByPath(o, 'n.x.y', 'v') // 中间缺失 → 创建对象
    expect(getByPath(o, 'n.x.y')).toBe('v')
  })

  it('interpolateValue：数值 lerp；颜色按通道插值；字符串非颜色=切换；端点正确', () => {
    expect(interpolateValue(10, 20, 0.5)).toBeCloseTo(15, 9)
    expect(interpolateValue(10, 20, 0)).toBe(10)
    expect(interpolateValue(10, 20, 1)).toBe(20)
    expect(interpolateValue('#102030', '#304050', 0.5)).toBe('#203040')
    expect(interpolateValue('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(interpolateValue('snow', 'star', 0.7)).toBe('star')
  })

  it('trackValueAt：排序/区间插值/缓动端点；首帧前=null（继承基准）/末帧后 clamp', () => {
    const track = {
      path: 'texts.songTitle.style.fontSize',
      frames: [
        { t: 2, value: 0.1, easing: 'linear' as const },
        { t: 6, value: 0.14, easing: 'easeOutCubic' as const },
        { t: 8, value: 0.1, easing: 'linear' as const }
      ]
    }
    expect(trackValueAt(track, 0)).toBeNull() // 首帧前=继承基准
    expect(trackValueAt(track, 10)).toBe(0.1) // 末帧后 clamp
    expect(trackValueAt(track, 4)).toBeCloseTo(0.12, 6) // 中点线性
    expect(trackValueAt(track, 6)).toBe(0.14)
    expect(trackValueAt({ path: 'x', frames: [] }, 5)).toBeNull()
  })

  it('resolveLayoutAt：段外=原布局；继承段=全局；覆盖段=段快照；关键帧覆盖生效', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    // 段外
    expect(resolveLayoutAt(base, 99)).toBe(base)
    // 继承段（layout=null）→ 全局基线
    const inherit = resolveLayoutAt(
      { ...base, timeline: doc([seg({ startSec: 2, endSec: 6 })]) },
      3
    )
    expect(inherit).not.toBe(base)
    expect(inherit.texts.songTitle.text).toBe('歌曲名')
    // 覆盖段（快照布局不同）
    const custom = structuredClone(base)
    custom.texts.songTitle.text = '副歌'
    const over = resolveLayoutAt(
      { ...base, timeline: doc([seg({ startSec: 2, endSec: 6, layout: custom })]) },
      3
    )
    expect(over.texts.songTitle.text).toBe('副歌')
    // 关键帧覆盖段内属性
    const kf = seg({
      startSec: 0,
      endSec: 10,
      keyframes: [
        {
          path: 'texts.songTitle.style.fontSize',
          frames: [
            { t: 0, value: 0.05, easing: 'linear' },
            { t: 10, value: 0.15, easing: 'linear' }
          ]
        }
      ]
    })
    const animated = resolveLayoutAt({ ...base, timeline: doc([kf]) }, 5)
    expect(animated.texts.songTitle.style.fontSize).toBeCloseTo(0.1, 9)
    expect(base.texts.songTitle.style.fontSize).not.toBeCloseTo(0.1, 9) // 输入不被修改
  })

  it('segmentAt：首个包含的段；重叠时先出现的优先；边界端点', () => {
    const d = doc([
      seg({ id: 'a', startSec: 0, endSec: 5 }),
      seg({ id: 'b', startSec: 5, endSec: 10 })
    ])
    expect(segmentAt(d, 0)?.id).toBe('a')
    expect(segmentAt(d, 4.999)?.id).toBe('a')
    expect(segmentAt(d, 5)?.id).toBe('b')
    expect(segmentAt(d, 10)).toBeNull()
  })

  it('hasTimeline：空=无；有片段=true', () => {
    expect(hasTimeline(structuredClone(DEFAULT_LAYOUT))).toBe(false)
    expect(hasTimeline({ ...structuredClone(DEFAULT_LAYOUT), timeline: doc([seg()]) })).toBe(true)
  })
})

describe('T9 片段边界语义', () => {
  const tdoc = (list: { id: string; a: number; b: number }[]): TimelineDocument => ({
    segments: list.map((x) => ({
      id: x.id,
      startSec: x.a,
      endSec: x.b,
      layout: null,
      keyframes: []
    }))
  })

  it('重叠校验：恰好相接不算重叠；真重叠成对返回', () => {
    expect(
      segmentOverlaps(
        tdoc([
          { id: 'A', a: 0, b: 10 },
          { id: 'B', a: 10, b: 20 }
        ])
      )
    ).toEqual([])
    const r1 = segmentOverlaps(
      tdoc([
        { id: 'A', a: 0, b: 15 },
        { id: 'B', a: 10, b: 20 }
      ])
    )
    expect(r1).toEqual([['A', 'B']])
    const r2 = segmentOverlaps(
      tdoc([
        { id: 'A', a: 0, b: 30 },
        { id: 'B', a: 5, b: 8 },
        { id: 'C', a: 20, b: 25 }
      ])
    )
    expect(r2.sort()).toEqual(
      [
        ['A', 'B'],
        ['A', 'C']
      ].sort()
    )
  })

  it('音频长度变化：超界片段删除、越界 endSec 钳制；无改动时 changed=false', () => {
    const r1 = clampSegmentsToDuration(
      tdoc([
        { id: 'A', a: 0, b: 10 },
        { id: 'B', a: 8, b: 20 },
        { id: 'C', a: 15, b: 18 }
      ]),
      12
    )
    expect(r1.changed).toBe(true)
    expect(r1.segments.map((s) => s.id)).toEqual(['A', 'B'])
    expect(r1.segments[1].endSec).toBe(12)
    const r2 = clampSegmentsToDuration(tdoc([{ id: 'A', a: 0, b: 10 }]), 10)
    expect(r2.changed).toBe(false)
  })

  it('硬切语义：重叠时排序在前（更早 start）生效', () => {
    const d = tdoc([
      { id: 'A', a: 0, b: 15 },
      { id: 'B', a: 10, b: 20 }
    ])
    expect(segmentAt(d, 12)?.id).toBe('A')
  })
})

describe('锚点间过渡（1.0.0 关键帧编辑体验：段落到帧 / 段落到段落 / 段落到全局 / 全局到段落）', () => {
  const FS = 'texts.songTitle.style.fontSize'
  const BASE = DEFAULT_LAYOUT.texts.songTitle.style.fontSize
  const sz = (l: ProjectLayout): number => l.texts.songTitle.style.fontSize
  const kfSeg = (
    frames: { t: number; value: number; easing: string }[],
    patch: Partial<TimelineSegment> = {}
  ): TimelineSegment => ({
    ...seg({ ...patch }),
    keyframes: [{ path: FS, frames: frames as never }]
  })

  it('段落到帧：基准→首帧按首帧过渡方式渐变；hold=到达前保持基准、到达突变', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const linear = resolveLayoutAt(
      { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'linear' }])]) },
      1
    )
    expect(sz(linear)).toBeCloseTo(BASE + (0.15 - BASE) * 0.5, 9) // p=0.5
    expect(
      sz(
        resolveLayoutAt(
          { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'linear' }])]) },
          0.5
        )
      )
    ).toBeCloseTo(BASE + (0.15 - BASE) * 0.25, 9)
    expect(
      sz(
        resolveLayoutAt(
          { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'linear' }])]) },
          2
        )
      )
    ).toBe(0.15)
    // easeOutCubic：p=0.5 → 0.875
    expect(
      sz(
        resolveLayoutAt(
          { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'easeOutCubic' }])]) },
          1
        )
      )
    ).toBeCloseTo(BASE + (0.15 - BASE) * 0.875, 9)
    // hold：到达前 = 基准（硬切），到达后 = 帧值
    const hdoc = doc([kfSeg([{ t: 2, value: 0.15, easing: 'hold' }])])
    expect(sz(resolveLayoutAt({ ...base, timeline: hdoc }, 1))).toBeCloseTo(BASE, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: hdoc }, 2))).toBe(0.15)
  })

  it('段落到帧：颜色按通道插值；输入布局不被修改', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const cs = 'texts.songTitle.style.color'
    const cdoc = doc([
      seg({
        id: 's1',
        startSec: 0,
        endSec: 10,
        keyframes: [{ path: cs, frames: [{ t: 2, value: '#000000', easing: 'linear' }] }]
      })
    ])
    const at1 = resolveLayoutAt({ ...base, timeline: cdoc }, 1)
    expect(at1.texts.songTitle.style.color).toBe('#808080') // #ffffff → #000000 中点
    expect(base.texts.songTitle.style.color).toBe('#ffffff') // 输入不被修改
  })

  it('全局到段落：物化段进入窗口 = 上一锚点（全局基线）→ 段快照软过渡', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const d = doc([seg({ id: 's1', startSec: 5, endSec: 15, layout: snap, transitionSec: 1 })])
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4))).toBeCloseTo(BASE, 9) // 窗口起点=上一锚点
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.5))).toBeCloseTo((BASE + 0.3) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBe(0.3)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBe(0.3)
  })

  it('段落到段落：后段进入窗口 = 前段结尾值 → 后段起始值软过渡（首帧在段起点=边界到达帧值）', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const s1 = kfSeg([{ t: 0, value: 0.05, easing: 'linear' }], { id: 'a', startSec: 0, endSec: 5 })
    const s2 = kfSeg([{ t: 0, value: 0.25, easing: 'linear' }], {
      id: 'b',
      startSec: 5,
      endSec: 15,
      transitionSec: 2
    })
    const d = doc([s1, s2])
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 3))).toBeCloseTo(0.05, 9) // 窗口起点=前段生效
    // 窗口 [3,5)：p=(4-3)/2=0.5；p=(4.5-3)/2=0.75 → lerp(0.05→0.25, p)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4))).toBeCloseTo(0.05 + 0.2 * 0.5, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.5))).toBeCloseTo(0.05 + 0.2 * 0.75, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.999))).toBeCloseTo(0.05 + 0.2 * 0.9995, 6)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBe(0.25)
  })

  it('段落到全局：段尾后无生效段 → 段结尾值回全局基线软过渡', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const d = doc([seg({ id: 's1', startSec: 0, endSec: 10, layout: snap, transitionSec: 2 })])
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 9))).toBe(0.3)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 10))).toBe(0.3) // 到达段尾=段值
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 11))).toBeCloseTo((0.3 + BASE) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 12))).toBeCloseTo(BASE, 9)
  })

  it('空隙链式过渡：段→全局（离开窗口）与全局→段（进入窗口）嵌套混合、连续无跳变', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const s1 = kfSeg([{ t: 0, value: 0.05, easing: 'linear' }], {
      id: 'a',
      startSec: 0,
      endSec: 5,
      transitionSec: 1
    })
    const s2 = kfSeg([{ t: 0, value: 0.25, easing: 'linear' }], {
      id: 'b',
      startSec: 5.5,
      endSec: 10,
      transitionSec: 1
    })
    const d = doc([s1, s2])
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    expect(at(4)).toBeCloseTo(0.05, 9)
    // t=5：S2 进入窗口 p=0.5（from=S1 离开窗口起点 p=0 → 段值 0.05）
    expect(at(5)).toBeCloseTo(0.05 + (0.25 - 0.05) * 0.5, 9)
    // t=5.25：进入 S2 窗口 p=0.75；from=S1 离开 p=0.25 → lerp(0.05, BASE, 0.25)
    const from = 0.05 + (BASE - 0.05) * 0.25
    expect(at(5.25)).toBeCloseTo(from + (0.25 - from) * 0.75, 9)
    expect(at(5.5)).toBe(0.25)
    expect(at(9.5)).toBe(0.25)
    expect(at(10.5)).toBeCloseTo((0.25 + BASE) / 2, 9) // S2 离开窗口中点
    expect(at(11.5)).toBeCloseTo(BASE, 9)
  })

  it('全局轨道与进入窗口并存：全局动画为底、段快照为顶（物化=冻结，全局不覆盖）', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const d: TimelineDocument = {
      segments: [seg({ id: 's1', startSec: 5, endSec: 15, layout: snap, transitionSec: 1 })],
      keyframes: [
        {
          path: FS,
          frames: [
            { t: 0, value: 0.05, easing: 'linear' },
            { t: 10, value: 0.15, easing: 'linear' }
          ]
        }
      ]
    }
    const base = structuredClone(DEFAULT_LAYOUT)
    // 4.5：全局动画值 0.095；窗口 p=0.5 → lerp(0.095, 0.3, 0.5)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.5))).toBeCloseTo((0.095 + 0.3) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 10))).toBe(0.3) // 段内物化冻结
  })

  it('lerpLayouts：端点身份、数值/颜色/数组/嵌套插值、输入不被修改', () => {
    const a = { x: 0.4, s: '#ffffff', arr: [1, 2], nest: { v: 0.1 } }
    const b = { x: 0.8, s: '#000000', arr: [3, 4], nest: { v: 0.3 } }
    expect(lerpLayouts(a as never, b as never, 0)).toBe(a)
    expect(lerpLayouts(a as never, b as never, 1)).toBe(b)
    const m = lerpLayouts(a as never, b as never, 0.5) as {
      x: number
      s: string
      arr: number[]
      nest: { v: number }
    }
    expect(m.x).toBeCloseTo(0.6, 9)
    expect(m.s).toBe('#808080')
    expect(m.arr).toEqual([2, 3])
    expect(m.nest.v).toBeCloseTo(0.2, 9)
    expect(a.x).toBe(0.4)
    expect(b.arr).toEqual([3, 4])
  })

  it('未配置过渡：resolveLayoutAt 身份快路径不变（段外返回原布局）', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(resolveLayoutAt(base, 99)).toBe(base)
  })
})
