/**
 * P3b 关键帧操作（参数行菱形入口用）：addKeyframeAt / hasKeyframe ——
 * 上下文自动路由（选中段 = 段轨道，否则全局基线轨道）；时间换算（段内相对秒/整曲绝对秒）统一在此。
 * 单职责：只做"打帧/查帧"，面板不改语义；时间以当前播放头为准（钩子入参 currentT）。
 */
import { useCallback, useMemo } from 'react'
import type { ProjectLayout } from '@shared/layout'
import { getByPath } from '@shared/timeline'
import type { Keyframe, PropertyTrack } from '@shared/timeline'

type UseProjectLike = {
  editSegId: string | null
  view: ProjectLayout
  layout: ProjectLayout
  updateSegmentTracks: (segId: string, tracks: PropertyTrack[]) => void
  updateDocKeyframes: (tracks: PropertyTrack[]) => void
}

export interface KeyframeOps {
  /** 路径当前是否已有帧（菱形点亮） */
  hasKeyframe: (path: string) => boolean
  /** 在当前播放头为该属性打帧（捕获当前上下文视图值） */
  addKeyframeAt: (path: string) => void
}

export function useKeyframeOps(project: UseProjectLike, currentT: number): KeyframeOps {
  const seg = useMemo(
    () =>
      project.editSegId
        ? ((project.layout.timeline?.segments ?? []).find((s) => s.id === project.editSegId) ??
          null)
        : null,
    [project.editSegId, project.layout.timeline]
  )
  const tracks = useMemo<PropertyTrack[]>(
    () => (seg ? (seg.keyframes ?? []) : (project.layout.timeline?.keyframes ?? [])),
    [seg, project.layout.timeline]
  )

  const hasKeyframe = useCallback(
    (path: string): boolean => tracks.some((x) => x.path === path && x.frames.length > 0),
    [tracks]
  )

  const addKeyframeAt = useCallback(
    (path: string) => {
      const raw = getByPath(project.view, path)
      if (typeof raw !== 'number' && typeof raw !== 'string') return
      const rel = seg ? currentT - seg.startSec : currentT
      const t = +Math.max(0, rel).toFixed(3)
      const frame: Keyframe = { t, value: raw, easing: 'linear' }
      const existing = tracks.find((x) => x.path === path)
      let next: PropertyTrack[]
      if (existing) {
        const frames = [...existing.frames.filter((f) => Math.abs(f.t - t) > 0.01), frame].sort(
          (a, b) => a.t - b.t
        )
        next = tracks.map((x) => (x.path === path ? { ...x, frames } : x))
      } else {
        next = [...tracks, { path, frames: [frame] }]
      }
      if (seg) project.updateSegmentTracks(seg.id, next)
      else project.updateDocKeyframes(next)
    },
    [project, seg, tracks, currentT]
  )

  return { hasKeyframe, addKeyframeAt }
}
