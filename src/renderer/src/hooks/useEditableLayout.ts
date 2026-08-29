import type { ProjectLayout } from '@shared/layout'
import { useLocale } from './useLocale'

/**
 * 编辑上下文化（1.0.0 T4）。
 * 编辑目标（null=全局基线 / 片段 id）由 useProject 持有（所有布局写入经 commit 路由到目标，
 * 继承式写时复制）；本 hook 只派生渲染用视图与上下文条标签——单一事实来源，无重复状态。
 *
 * ⚠ 不在此 hook 内调用 useProject()：useProject 是每组件单实例 hook，
 * 二次调用会创建一套平行的项目状态。必须把 App 的 project 实例传入。
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
} {
  const { t } = useLocale()
  const { editSegId, editSegIndex, view } = project
  return {
    segId: editSegId,
    segIndex: editSegIndex,
    isSegment: editSegIndex > 0,
    view,
    label:
      editSegIndex > 0 ? t('timeline.editSegment', { i: editSegIndex }) : t('timeline.editGlobal')
  }
}
