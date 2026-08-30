import { describe, expect, it } from 'vitest'
import {
  clampSegmentBoundsToNeighbors,
  resolveLayoutAt,
  segmentOverlaps,
  splitTimelineAt,
  trackValueAt,
  type TimelineDocument
} from './timeline'
import { DEFAULT_LAYOUT } from './layout'

function docOf(list: { id: string; a: number; b: number }[]): TimelineDocument {
  return {
    segments: list.map((x) => ({
      id: x.id,
      startSec: x.a,
      endSec: x.b,
      layout: null,
      keyframes: []
    }))
  }
}

describe('timelineSplit（纯函数）', () => {
  it('无片段：整首切两段 [0,t)/[t,dur)，均继承全局', () => {
    const r = splitTimelineAt({ segments: [] }, 60, 221)
    expect(r.changed).toBe(true)
    expect(r.segments.map((s) => [s.startSec, s.endSec])).toEqual([
      [0, 60],
      [60, 221]
    ])
    expect(segmentOverlaps({ segments: r.segments })).toEqual([])
  })

  it('连续 5 次分割无重叠（用户反馈再现场景）', () => {
    let segs: TimelineDocument = { segments: [] }
    for (const t of [30, 60.55, 90, 120.5, 150]) {
      segs = { segments: splitTimelineAt(segs, t, 221).segments }
    }
    expect(segmentOverlaps(segs)).toEqual([])
    const s = [...segs.segments].sort((a, b) => a.startSec - b.startSec)
    expect(s.length).toBe(6)
    expect(s[0].startSec).toBe(0)
    expect(s[s.length - 1].endSec).toBe(221)
  })

  it('边界钳制：拖拽不侵入相邻段（允许精确相接——微小拖动不丢配对切点）', () => {
    const segs = docOf([
      { id: 'A', a: 0, b: 30 },
      { id: 'B', a: 30, b: 60 },
      { id: 'C', a: 60, b: 90 }
    ])
    // B 左边界拖到 10 → 钳到 30；右边界拖到 85 → 钳到 60（半开区间不重叠）
    const [a, b] = clampSegmentBoundsToNeighbors(segs.segments, 'B', 10, 85)
    expect(a).toBe(30)
    expect(b).toBe(60)
    const [a2, b2] = clampSegmentBoundsToNeighbors(segs.segments, 'A', -5, 25)
    expect(a2).toBe(0)
    expect(b2).toBe(25)
    const [a3, b3] = clampSegmentBoundsToNeighbors(segs.segments, 'C', 60, 200)
    expect(a3).toBe(60)
    expect(b3).toBe(200)
  })

  it('overlaps 防御性校验仍在（半开区间恰好相接不算）', () => {
    expect(
      segmentOverlaps(
        docOf([
          { id: 'A', a: 0, b: 30 },
          { id: 'B', a: 30, b: 60 }
        ])
      )
    ).toEqual([])
  })

  it('全局基线可动画（用户 #3）：无分割也能打帧，绝对 t 插值', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const doc: TimelineDocument = {
      segments: [],
      keyframes: [
        {
          path: 'mainImage.rect.x',
          frames: [
            { t: 0, value: 0.1, easing: 'linear' },
            { t: 10, value: 0.5, easing: 'linear' }
          ]
        }
      ]
    }
    const l = { ...base, timeline: doc }
    expect(resolveLayoutAt(l, 5).mainImage.rect.x).toBeCloseTo(0.3, 5)
    expect(resolveLayoutAt(l, 0).mainImage.rect.x).toBeCloseTo(0.1, 5)
    expect(resolveLayoutAt(l, 10).mainImage.rect.x).toBeCloseTo(0.5, 5)
  })

  it('用户语义：首帧之前=继承基准；t>=首帧=接管（帧间插值/末帧后 clamp）', () => {
    const track = {
      path: 'mainImage.rect.x',
      frames: [
        { t: 10, value: 0.8, easing: 'linear' },
        { t: 20, value: 0.4, easing: 'linear' }
      ]
    }
    expect(trackValueAt(track, 9.9)).toBeNull()
    expect(trackValueAt(track, 10)).toBe(0.8)
    expect(trackValueAt(track, 15)).toBeCloseTo(0.6, 5)
    expect(trackValueAt(track, 30)).toBe(0.4)
  })

  it('空帧槽：裸创建后可拆分（>切点平移给新段）、随段删除', () => {
    const d = docOf([{ id: 'A', a: 0, b: 60 }])
    d.segments[0].frameSlots = [10, 45]
    const r = splitTimelineAt(d, 30, 60)
    expect(r.changed).toBe(true)
    const [s1, s2] = r.segments
    expect(s1.frameSlots).toEqual([10])
    expect(s2.frameSlots).toEqual([15])
  })

  it('全局为底、段级为顶：段内轨道覆盖全局轨道', () => {
    const base = structuredClone(DEFAULT_LAYOUT)
    const l = {
      ...base,
      timeline: {
        segments: [
          {
            id: 'S',
            startSec: 0,
            endSec: 10,
            layout: null,
            keyframes: [
              {
                path: 'mainImage.rect.x',
                frames: [
                  { t: 2, value: 0.9, easing: 'linear' },
                  { t: 4, value: 0.8, easing: 'linear' }
                ]
              }
            ]
          }
        ],
        keyframes: [
          {
            path: 'mainImage.rect.x',
            frames: [
              { t: 0, value: 0.1, easing: 'linear' },
              { t: 10, value: 0.5, easing: 'linear' }
            ]
          }
        ]
      }
    }
    // t=3：段轨道插值 0.85 覆盖全局 0.22
    expect(resolveLayoutAt(l, 3).mainImage.rect.x).toBeCloseTo(0.85, 5)
    // t=5：段轨超出末帧=0.8（clamp）覆盖全局 0.3
    expect(resolveLayoutAt(l, 5).mainImage.rect.x).toBeCloseTo(0.8, 5)
  })
})
