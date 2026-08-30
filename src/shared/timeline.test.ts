import { describe, expect, it } from 'vitest'
import {
  beatTimeAt,
  clampSegmentsToDuration,
  computeTransitionWindows,
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

describe('段属性过渡（v5：过渡属于段落本身——目标跟随场景：相接段直接互溶 / 全局基线）', () => {
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
  /** 物化段（快照 fontSize=v） */
  const matSeg = (
    id: string,
    a: number,
    b: number,
    v: number,
    patch: Partial<TimelineSegment> = {}
  ): TimelineSegment => {
    const layout = structuredClone(DEFAULT_LAYOUT)
    layout.texts.songTitle.style.fontSize = v
    return seg({ id, startSec: a, endSec: b, layout, ...patch })
  }

  it('段落到帧：基准→首帧按首帧过渡方式渐变；hold=到达前保持基准、到达突变', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const linear = resolveLayoutAt(
      { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'linear' }])]) },
      1
    )
    expect(sz(linear)).toBeCloseTo(BASE + (0.15 - BASE) * 0.5, 9)
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
    expect(
      sz(
        resolveLayoutAt(
          { ...base, timeline: doc([kfSeg([{ t: 2, value: 0.15, easing: 'easeOutCubic' }])]) },
          1
        )
      )
    ).toBeCloseTo(BASE + (0.15 - BASE) * 0.875, 9)
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
    expect(at1.texts.songTitle.style.color).toBe('#808080')
    expect(base.texts.songTitle.style.color).toBe('#ffffff')
  })

  it('段尾过渡↔全局基线（段后无相接段）：本段结尾与全局互溶、边界连续', () => {
    const d = doc([
      matSeg('s1', 0, 10, 0.3, { transitionOut: { durationSec: 2, easing: 'linear' } })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 8))).toBe(0.3)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 9))).toBeCloseTo((0.3 + BASE) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 10))).toBeCloseTo(BASE, 9) // 与全局相接连续
  })

  it('段首过渡↔全局基线（段前无相接段）：本段开头与全局互溶、边界连续', () => {
    const d = doc([
      matSeg('s1', 5, 15, 0.3, { transitionIn: { durationSec: 1, easing: 'linear' } })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBeCloseTo(BASE, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5.5))).toBeCloseTo((BASE + 0.3) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBe(0.3)
  })

  it('相接两段直接互溶（前段段尾过渡→后段，不经过全局基线）', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3, { transitionOut: { durationSec: 2, easing: 'linear' } }),
      matSeg('b', 5, 10, 0.25)
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    // 窗口 [3,5)：t=4 → lerp(0.3, 0.25, 0.5) —— 若经全局基线则应为 lerp(0.3, BASE, 0.5)≈0.1975
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4))).toBeCloseTo(0.275, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBe(0.25) // 与后段起始无缝
  })

  it('相接两段直接互溶（后段段首过渡←前段），t=切点处 = 前段结尾值（连续）', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3),
      matSeg('b', 5, 10, 0.25, { transitionIn: { durationSec: 2, easing: 'linear' } })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    // 窗口 [5,7)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBe(0.3)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBeCloseTo(0.275, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 7))).toBe(0.25)
  })

  it('两侧都设过渡：合并为一条连续互溶窗（A→B 直接，时长相加）', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3, { transitionOut: { durationSec: 2, easing: 'linear' } }),
      matSeg('b', 5, 10, 0.25, { transitionIn: { durationSec: 1, easing: 'linear' } })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    // 窗口 [3,6)：t=4 → p=1/3；t=5（切点）→ p=2/3
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4))).toBeCloseTo(0.3 + (0.25 - 0.3) / 3, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBeCloseTo(
      0.3 + (0.25 - 0.3) * (2 / 3),
      9
    )
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBe(0.25)
  })

  it('过渡曲线：窗口内先线性进度再按曲线映射（easeOutCubic 中点 = 0.875）', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3),
      matSeg('b', 5, 10, 0.25, { transitionIn: { durationSec: 2, easing: 'easeOutCubic' } })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    // 窗口 [5,7)，t=6 → p=0.5 → 0.875
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBeCloseTo(
      0.3 + (0.25 - 0.3) * 0.875,
      9
    )
  })

  it('hold 曲线 = 硬切退化；未配置过渡 = 身份快路径', () => {
    const d = doc([matSeg('a', 0, 5, 0.3, { transitionOut: { durationSec: 2, easing: 'hold' } })])
    const base = structuredClone(DEFAULT_LAYOUT)
    expect(computeTransitionWindows(d)).toHaveLength(0)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.5))).toBe(0.3)
    expect(resolveLayoutAt(base, 99)).toBe(base)
  })

  it('窗口各 ≤ 段长一半（长过渡自动收缩，互不重叠）', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3, {
        transitionIn: { durationSec: 10, easing: 'linear' },
        transitionOut: { durationSec: 10, easing: 'linear' }
      })
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    const wins = computeTransitionWindows(d)
    expect(wins).toHaveLength(2) // 段首↔全局 + 段尾↔全局
    expect(wins[0].w1 - wins[0].w0).toBeCloseTo(2.5, 9)
    expect(wins[1].w1 - wins[1].w0).toBeCloseTo(2.5, 9)
    // 中点 = 段生效态（两窗口不相交）
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 2.5))).toBe(0.3)
  })

  it('修改段长不失效（用户核心诉求）：段尾过渡仍在本段结尾、长度变化后窗口跟随', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const d1 = doc([
      matSeg('a', 0, 5, 0.3, { transitionOut: { durationSec: 1, easing: 'linear' } }),
      matSeg('b', 5, 15, 0.25)
    ])
    expect(sz(resolveLayoutAt({ ...base, timeline: d1 }, 4.5))).toBeCloseTo(0.275, 9)
    // 把 a 的结尾拖到 6（b 顺延到 6→16）：设置原样保留，窗口跟随 [5,6)
    const d2 = doc([
      matSeg('a', 0, 6, 0.3, { transitionOut: { durationSec: 1, easing: 'linear' } }),
      matSeg('b', 6, 16, 0.25)
    ])
    expect(sz(resolveLayoutAt({ ...base, timeline: d2 }, 5.5))).toBeCloseTo(0.275, 9)
  })

  it('空隙：段尾过渡与全局互溶（后接非段）；后段无段首过渡 = 硬切', () => {
    const d = doc([
      matSeg('a', 0, 5, 0.3, { transitionOut: { durationSec: 1, easing: 'linear' } }),
      matSeg('b', 6, 10, 0.25)
    ])
    const base = structuredClone(DEFAULT_LAYOUT)
    // 窗口 [4,5)：经全局基线
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 4.5))).toBeCloseTo((0.3 + BASE) / 2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBeCloseTo(BASE, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 6))).toBe(0.25)
  })

  it('全局轨道与过渡并存：全局动画为底（段首过渡来源 = 全局动画值）', () => {
    const d: TimelineDocument = {
      segments: [matSeg('s1', 5, 15, 0.3, { transitionIn: { durationSec: 1, easing: 'linear' } })],
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
    // t=5.5：全局动画值 0.105 → lerp(0.105, 0.3, 0.5)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5.5))).toBeCloseTo(0.2025, 9)
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

  it('变 BPM 节拍蓄积：分段常量积分——跨段变速拍相位连续（不跳拍）', () => {
    // 恒定 120 BPM（无时间轴快路径）
    const l0 = structuredClone(DEFAULT_LAYOUT)
    l0.visualizer.bpm = 120
    expect(beatTimeAt(l0, 10)).toBeCloseTo(20, 9)
    // 分段变速：段1 [0,10) 120BPM（period 0.5）；段2 [10,20) 60BPM（period 1）
    const s1 = structuredClone(DEFAULT_LAYOUT)
    s1.visualizer.bpm = 120
    const s2 = structuredClone(DEFAULT_LAYOUT)
    s2.visualizer.bpm = 60
    const d: TimelineDocument = {
      segments: [
        seg({ id: 'a', startSec: 0, endSec: 10, layout: s1 }),
        seg({ id: 'b', startSec: 10, endSec: 20, layout: s2 })
      ]
    }
    const l = structuredClone(DEFAULT_LAYOUT)
    const at = (t: number): number => beatTimeAt({ ...l, timeline: d }, t)
    expect(at(5)).toBeCloseTo(10, 9) // 5s / 0.5
    expect(at(15)).toBeCloseTo(25, 9) // 20 + 5s / 1
    expect(at(20)).toBeCloseTo(30, 9) // 20 + 10
    // 关段（bpm null）不推进；BPM 优先于周期
    const s3 = structuredClone(DEFAULT_LAYOUT)
    s3.visualizer.bpm = 120
    s3.visualizer.beatIntervalSec = 1
    const d2: TimelineDocument = {
      segments: [seg({ id: 'a', startSec: 0, endSec: 5, layout: s3 })]
    }
    // 段前全局区（bpm null）= 不推进，段内 120BPM → beats(5) = 0 + 5/0.5 - 0（段从 0 起）
    expect(beatTimeAt({ ...l, timeline: d2 }, 0.5)).toBeCloseTo(1, 9)
    // 段后（> end）全局区不推进
    expect(beatTimeAt({ ...l, timeline: d2 }, 6)).toBeCloseTo(10, 9)
  })

  it('段落属性变 BPM：选中段落改 BPM = 该段快照自带值（无需关键帧），跨段变速生效', () => {
    const s1 = structuredClone(DEFAULT_LAYOUT)
    s1.visualizer.bpm = 120
    const s2 = structuredClone(DEFAULT_LAYOUT)
    s2.visualizer.bpm = 60
    const d: TimelineDocument = {
      segments: [
        seg({ id: 'a', startSec: 0, endSec: 10, layout: s1 }),
        seg({ id: 'b', startSec: 10, endSec: 20, layout: s2 })
      ]
    }
    const base = structuredClone(DEFAULT_LAYOUT)
    // 逐帧解析：段内取段自己的 BPM（段落属性）；段外 = 全局（null）
    expect(resolveLayoutAt({ ...base, timeline: d }, 5).visualizer.bpm).toBe(120)
    expect(resolveLayoutAt({ ...base, timeline: d }, 15).visualizer.bpm).toBe(60)
    expect(resolveLayoutAt({ ...base, timeline: d }, 25).visualizer.bpm).toBeNull()
    expect(resolveLayoutAt({ ...base, timeline: d }, 25).visualizer.beatIntervalSec).toBeNull()
  })
})
