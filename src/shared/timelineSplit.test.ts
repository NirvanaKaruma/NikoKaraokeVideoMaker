import { describe, expect, it } from 'vitest'
import {
  clampSegmentBoundsToNeighbors,
  segmentOverlaps,
  splitTimelineAt,
  type TimelineDocument
} from './timeline'

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

  it('边界钳制：拖拽不侵入相邻段（保留 0.05s 缝）', () => {
    const segs = docOf([
      { id: 'A', a: 0, b: 30 },
      { id: 'B', a: 30, b: 60 },
      { id: 'C', a: 60, b: 90 }
    ])
    // B 左边界拖到 10 → 被钳到 30.05；右边界拖到 85 → 被钳到 59.95
    const [a, b] = clampSegmentBoundsToNeighbors(segs.segments, 'B', 10, 85)
    expect(a).toBeGreaterThanOrEqual(30.05)
    expect(b).toBeLessThanOrEqual(59.95)
    const [a2, b2] = clampSegmentBoundsToNeighbors(segs.segments, 'A', -5, 25)
    expect(a2).toBe(0)
    expect(b2).toBe(25)
    const [a3, b3] = clampSegmentBoundsToNeighbors(segs.segments, 'C', 60, 200)
    expect(a3).toBe(60.05)
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
})
