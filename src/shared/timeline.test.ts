import { describe, expect, it } from 'vitest'
import {
  clampSegmentsToDuration,
  getByPath,
  hasTimeline,
  interpolateValue,
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

  it('trackValueAt：排序/区间插值/缓动端点/首尾 clamp', () => {
    const track = {
      path: 'texts.songTitle.style.fontSize',
      frames: [
        { t: 2, value: 0.1, easing: 'linear' as const },
        { t: 6, value: 0.14, easing: 'easeOutCubic' as const },
        { t: 8, value: 0.1, easing: 'linear' as const }
      ]
    }
    expect(trackValueAt(track, 0)).toBe(0.1) // 首帧前 clamp
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
