import { useState } from 'react'
import type { ProjectLayout } from '@shared/layout'
import { useLocale } from './useLocale'

/**
 * 编辑上下文化（1.0.0 T4）。
 * 编辑目标（null=全局基线 / 片段 id）由 useProject 持有；本 hook 派生渲染用视图与标签。
 * 1.1.0：携带"选中关键帧"标注——标签 = 段落 N · 关键帧 t=xx.xxs（显式显示正在编辑的内容）。
 *
 * ⚠ 不在此 hook 内调用 useProject()：useProject 是每组件单实例 hook，二次调用会创建平行状态。
 */
export function useEditableLayout(project: {
  layout: ProjectLayout
  view: ProjectLayout
  editSegId: string | null
  editSegIndex: number
  setEditSegment: (id: string | null) => void
}): {
  segId: string | null
  segIndex: number
  isSegment: boolean
  view: ProjectLayout
  label: string
  /** 当前选中关键帧绝对秒（非空 → 标签追加「关键帧 t=」） */
  kfT: number | null
  setKfT: (t: number | null) => void
} {
  const { t } = useLocale()
  const { editSegId, editSegIndex, view } = project
  const [kfT, setKfT] = useState<number | null>(null)
  return {
    segId: editSegId,
    segIndex: editSegIndex,
    isSegment: editSegIndex > 0,
    view,
    kfT,
    setKfT,
    label:
      editSegIndex > 0
        ? kfT != null
          ? t('timeline.editKf', { i: editSegIndex, t: kfT.toFixed(2) })
          : t('timeline.editSegment', { i: editSegIndex })
        : t('timeline.editGlobal')
  }
}
