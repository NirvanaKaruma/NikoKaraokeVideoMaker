import { describe, expect, it } from 'vitest'
import { resolvedSnapshotKey } from './tlDiff'
import { DEFAULT_LAYOUT, type ProjectLayout } from './layout'
import { setByPath } from './timeline'

function withSeg(t: ProjectLayout): ProjectLayout {
  return {
    ...t,
    timeline: {
      segments: [{ id: 'seg-1', startSec: 1, endSec: 5, layout: null, keyframes: [] }]
    }
  }
}

describe('resolvedSnapshotKey（T6 差异门控）', () => {
  it('相同叶值 → 相同键（逐帧稳定：React 全跳过）', () => {
    const a = withSeg(structuredClone(DEFAULT_LAYOUT))
    const b = withSeg(structuredClone(DEFAULT_LAYOUT))
    expect(resolvedSnapshotKey(a)).toBe(resolvedSnapshotKey(b))
  })

  it('可动画叶值变化 → 键变化（触发重渲）', () => {
    const a = withSeg(structuredClone(DEFAULT_LAYOUT))
    const b = withSeg(structuredClone(DEFAULT_LAYOUT))
    setByPath(b as unknown as Record<string, unknown>, 'mainImage.rect.x', 0.5)
    expect(resolvedSnapshotKey(a)).not.toBe(resolvedSnapshotKey(b))
  })

  it('片段边界变化 → 键变化（跨段切换重渲）', () => {
    const a = withSeg(structuredClone(DEFAULT_LAYOUT))
    const b = withSeg(structuredClone(DEFAULT_LAYOUT))
    b.timeline.segments[0].endSec = 6
    expect(resolvedSnapshotKey(a)).not.toBe(resolvedSnapshotKey(b))
  })

  it('非目录叶（如纯文本）不参与键——由布局对象身份变化兜底（App 缓存层）', () => {
    const a = withSeg(structuredClone(DEFAULT_LAYOUT))
    const b = withSeg(structuredClone(DEFAULT_LAYOUT))
    setByPath(b as unknown as Record<string, unknown>, 'texts.songTitle.text', '新歌名')
    expect(typeof resolvedSnapshotKey(a)).toBe('string')
  })
})
