/**
 * 时间轴预览差异门控（1.0.0 T6）：逐帧 resolve 后，只用「可动画叶值 + 片段结构」生成稳定性键。
 * 键不变 → 解析结果视觉等价 → 复用同一布局对象（React 跳过整棵画布树重渲染）；
 * 键变化（片段切换/关键帧动画/面板改值）→ 正常重渲。纯函数，预览/导出共用（核心约束 A）。
 */
import { getByPath, hasTimeline } from './timeline'
import { KEYFRAME_CATALOG } from './keyframeCatalog'
import type { ProjectLayout } from './layout'

export function resolvedSnapshotKey(layout: ProjectLayout): string {
  const parts: string[] = []
  if (hasTimeline(layout)) {
    const segs = (layout.timeline?.segments ?? []).map((s) => [
      s.id.slice(0, 6),
      s.startSec,
      s.endSec,
      s.layout ? 1 : 0,
      s.keyframes?.length ?? 0
    ])
    parts.push(JSON.stringify(segs))
  }
  for (const c of KEYFRAME_CATALOG) {
    const v = getByPath(layout, c.path)
    parts.push(typeof v === 'number' ? v.toFixed(4) : String(v))
  }
  return parts.join('|')
}
