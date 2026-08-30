import { describe, expect, it } from 'vitest'
import {
  clampSegmentsToDuration,
  computeCutWindows,
  getByPath,
  headCutKey,
  hasTimeline,
  interpolateValue,
  lerpLayouts,
  pairCutKey,
  remapTransitionsAfterSplit,
  resolveLayoutAt,
  segmentAt,
  segmentOverlaps,
  setByPath,
  tailCutKey,
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

describe('切点过渡（NLE 式：过渡属于编辑点/切点；段落到帧 / 段间切点 / 段首 / 段尾）', () => {
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
  /** 带切点过渡配置的时间轴文档 */
  const dT = (
    timeline: TimelineDocument,
    transitions: Record<string, number>
  ): TimelineDocument => ({
    ...timeline,
    transitions
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

  it('段首切点（全局基线 → 物化段）：居中互溶，切点两侧各半', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const tl = doc([seg({ id: 's1', startSec: 5, endSec: 15, layout: snap })])
    const d = dT(tl, { [headCutKey('s1')]: 1 })
    const base = structuredClone(DEFAULT_LAYOUT)
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    // 窗口 [4.5,5.5)：d=1 两侧各半
    expect(at(4.5)).toBeCloseTo(BASE, 9)
    expect(at(4.75)).toBeCloseTo(BASE + (0.3 - BASE) * 0.25, 9)
    expect(at(5)).toBeCloseTo((BASE + 0.3) / 2, 9)
    expect(at(5.25)).toBeCloseTo(BASE + (0.3 - BASE) * 0.75, 9)
    expect(at(5.5)).toBe(0.3)
    expect(at(6)).toBe(0.3)
  })

  it('段间切点（相接 A|B）：单条过渡居中互溶；无配置 = 硬切', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const s1 = kfSeg([{ t: 0, value: 0.05, easing: 'linear' }], { id: 'a', startSec: 0, endSec: 5 })
    const s2 = kfSeg([{ t: 0, value: 0.25, easing: 'linear' }], {
      id: 'b',
      startSec: 5,
      endSec: 15
    })
    const d = dT(doc([s1, s2]), { [pairCutKey('a', 'b')]: 2 })
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    // 窗口 [4,6)：d=2 切点两侧各半
    expect(at(3)).toBeCloseTo(0.05, 9)
    expect(at(4)).toBeCloseTo(0.05, 9)
    expect(at(4.5)).toBeCloseTo(0.05 + 0.2 * 0.25, 9)
    expect(at(5)).toBeCloseTo(0.05 + 0.2 * 0.5, 9)
    expect(at(5.5)).toBeCloseTo(0.05 + 0.2 * 0.75, 9)
    expect(at(6)).toBe(0.25)
    // 无配置 → 硬切
    const d0 = doc([s1, s2])
    expect(sz(resolveLayoutAt({ ...base, timeline: d0 }, 4.99))).toBeCloseTo(0.05, 6)
    expect(sz(resolveLayoutAt({ ...base, timeline: d0 }, 5))).toBe(0.25)
  })

  it('段尾切点（本段 → 全局基线）：居中、歌曲尾侧完整', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const tl = doc([seg({ id: 's1', startSec: 0, endSec: 10, layout: snap })])
    const d = dT(tl, { [tailCutKey('s1')]: 2 })
    const base = structuredClone(DEFAULT_LAYOUT)
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    // 歌曲尾切点：右侧无内容 → 淡出在段内完整 d=2s：[8,10)
    expect(at(8)).toBe(0.3)
    expect(at(9)).toBeCloseTo((0.3 + BASE) / 2, 9)
    expect(at(10)).toBeCloseTo(BASE, 9)
  })

  it('空隙：A|g 与 g|B 两条切点、半隙钳制、精确相接不重叠、中点 = 全局基线', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const s1 = kfSeg([{ t: 0, value: 0.05, easing: 'linear' }], { id: 'a', startSec: 0, endSec: 5 })
    const s2 = kfSeg([{ t: 0, value: 0.25, easing: 'linear' }], {
      id: 'b',
      startSec: 5.5,
      endSec: 10
    })
    const trans = { [tailCutKey('a')]: 1, [headCutKey('b')]: 1 }
    const d = dT(doc([s1, s2]), trans)
    const wins = computeCutWindows({ segments: d.segments }, trans)
    expect(wins).toHaveLength(2)
    // 精确相接（无重叠无缝隙）：[4.5,5.25) + [5.25,6)
    expect(wins[0].pos + wins[0].hR).toBeCloseTo(wins[1].pos - wins[1].hL, 9)
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    expect(at(4.75)).toBeCloseTo(0.05 + (BASE - 0.05) / 3, 9)
    expect(at(5)).toBeCloseTo(0.05 + (BASE - 0.05) * (2 / 3), 9)
    expect(at(5.25)).toBeCloseTo(BASE, 9)
    expect(at(5.5)).toBeCloseTo(BASE + (0.25 - BASE) / 3, 9)
    expect(at(5.75)).toBeCloseTo(BASE + (0.25 - BASE) * (2 / 3), 9)
    expect(at(6)).toBe(0.25)
    expect(at(4)).toBeCloseTo(0.05, 9) // 前段生效
  })

  it('切点身份保持：拖开（空隙）后 A|B 配置不生效但保留；重接后原样生效', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const s1 = kfSeg([{ t: 0, value: 0.05, easing: 'linear' }], { id: 'a', startSec: 0, endSec: 5 })
    const s2 = kfSeg([{ t: 0, value: 0.25, easing: 'linear' }], {
      id: 'b',
      startSec: 5,
      endSec: 10
    })
    const trans = { [pairCutKey('a', 'b')]: 1 }
    const d = dT(doc([s1, s2]), trans)
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    expect(at(5)).toBeCloseTo(0.15, 9) // 相接：居中互溶
    // 拖开：b 起始 5.4 → 切点对 (a|b) 不生效（保留在配置里），成为 A|g + g|B（无配置=硬切）
    const dGap = dT(doc([s1, { ...s2, startSec: 5.4 }]), trans)
    const wins = computeCutWindows({ segments: dGap.segments }, trans)
    expect(wins.some((w) => w.key === pairCutKey('a', 'b'))).toBe(false)
    expect(trans[pairCutKey('a', 'b')]).toBe(1) // 配置保留
    const atG = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: dGap }, t))
    expect(atG(4.9)).toBeCloseTo(0.05, 6)
    expect(atG(5.2)).toBeCloseTo(BASE, 9) // 空隙 = 全局基线（两端硬切）
    expect(atG(5.4)).toBe(0.25)
    // 重接：原配置原样生效
    const dBack = dT(doc([s1, s2]), trans)
    expect(sz(resolveLayoutAt({ ...base, timeline: dBack }, 5))).toBeCloseTo(0.15, 9)
  })

  it('0 时刻段首切点：外侧不可达 → 盈余转内侧，获得完整时长', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const tl = doc([seg({ id: 's1', startSec: 0, endSec: 10, layout: snap })])
    const d = dT(tl, { [headCutKey('s1')]: 2 })
    const wins = computeCutWindows({ segments: d.segments }, d.transitions ?? {})
    expect(wins[0].hL).toBe(0)
    expect(wins[0].hR).toBe(2) // 完整 2s 淡入（[0,2)）
    const base = structuredClone(DEFAULT_LAYOUT)
    const at = (t: number): number => sz(resolveLayoutAt({ ...base, timeline: d }, t))
    expect(at(0.5)).toBeCloseTo(BASE + (0.3 - BASE) * 0.25, 9)
    expect(at(1.5)).toBeCloseTo(BASE + (0.3 - BASE) * 0.75, 9)
    expect(at(2)).toBe(0.3)
  })

  it('全局轨道与段首切点并存：全局动画为底、物化段快照为顶（冻结）', () => {
    const snap = structuredClone(DEFAULT_LAYOUT)
    snap.texts.songTitle.style.fontSize = 0.3
    const tl: TimelineDocument = {
      segments: [seg({ id: 's1', startSec: 5, endSec: 15, layout: snap })],
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
    const d = dT(tl, { [headCutKey('s1')]: 1 })
    const base = structuredClone(DEFAULT_LAYOUT)
    // 切点 t=5：p=0.5；from=全局动画值 0.10 → lerp(0.10, 0.3, 0.5)=0.2
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 5))).toBeCloseTo(0.2, 9)
    expect(sz(resolveLayoutAt({ ...base, timeline: d }, 10))).toBe(0.3) // 段内物化冻结
  })

  it('分割重映射：左锚点 = 原段 → 右半段；段首（右锚点 = 原段）留在左半段', () => {
    const trans: Record<string, number> = {
      [headCutKey('a')]: 1, // 段首 → 留左半段（a）
      [tailCutKey('a')]: 0.5, // 段尾 → 右半段（a2）
      [pairCutKey('a', 'b')]: 2, // 与后段切点 → (a2|b)
      [pairCutKey('p', 'a')]: 3 // 与前段切点 → 留 (p|a)
    }
    const r = remapTransitionsAfterSplit(trans, 'a', 'a2')
    expect(r[headCutKey('a')]).toBe(1)
    expect(r[tailCutKey('a2')]).toBe(0.5)
    expect(r[pairCutKey('a2', 'b')]).toBe(2)
    expect(r[pairCutKey('p', 'a')]).toBe(3)
    expect(r[pairCutKey('a', 'b')]).toBeUndefined()
    expect(r[tailCutKey('a')]).toBeUndefined()
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
