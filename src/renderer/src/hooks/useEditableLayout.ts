import type { ProjectLayout } from '@shared/layout'
import { useLocale } from './useLocale'

/**
 * 编辑上下文化（1.0.0 T4；1.1.0 修复"选中帧不显示"bug）：
 * 编辑目标（null=全局基线 / 片段 id）由 useProject 持有；**选中关键帧由 App 传入**（kfSelT 单一状态源），
 * 标签 = 段落 N · 关键帧 t=xx.xxs（显式显示正在编辑的内容）。
 *
 * ⚠ 不在此 hook 内调用 useProject()：useProject 是每组件单实例 hook，二次调用会创建平行状态。
 */
export function useEditableLayout(
  project: {
    layout: ProjectLayout
    view: ProjectLayout
    editSegId: string | null
    editSegIndex: number
    setEditSegment: (id: string | null) => void
  },
  kfSelT: number | null
): {
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
      editSegIndex > 0
        ? kfSelT != null
          ? t('timeline.editKf', { i: editSegIndex, t: kfSelT.toFixed(2) })
          : t('timeline.editSegment', { i: editSegIndex })
        : kfSelT != null
          ? t('timeline.editKfGlobal', { t: kfSelT.toFixed(2) })
          : t('timeline.editGlobal')
  }
}
