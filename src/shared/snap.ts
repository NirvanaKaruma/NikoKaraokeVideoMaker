/**
 * 吸附对齐线（0.9.0）：纯函数（可单测、确定性）。
 * 拖动中矩形 → 目标线（画布边缘/中心 + 其余元素边/中线）→ 距阈值内吸附并返回引导线。
 * 全部像素坐标（画布逻辑空间；预览/导出各自画布一致）。
 */

/** 引导线：'v' = 竖线 at x=pos；'h' = 横线 at y=pos */
export interface SnapLine {
  axis: 'h' | 'v'
  pos: number
}

export interface SnapRect {
  x: number
  y: number
  w: number
  h: number
}

export interface SnapResult {
  x: number
  y: number
  lines: SnapLine[]
}

/** 吸附阈值（逻辑像素，1920×1080 空间） */
export const SNAP_THRESHOLD = 8

/**
 * 计算吸附：返回吸附后的矩形位置与引导线（无吸附 = 原位置 + 空线）。
 * 候选目标线：画布左/中/右、上/中/下 + 每个目标矩形的左中右/上中下；
 * 拖动矩形以 左中右/上中下 六个对齐锚点对各目标线找最近命中（阈值内取最小位移）。
 */
export function snapPosition(
  move: SnapRect,
  targets: SnapRect[],
  canvas: { width: number; height: number },
  threshold = SNAP_THRESHOLD
): SnapResult {
  const xs: number[] = [0, canvas.width / 2, canvas.width]
  const ys: number[] = [0, canvas.height / 2, canvas.height]
  for (const t of targets) {
    xs.push(t.x, t.x + t.w / 2, t.x + t.w)
    ys.push(t.y, t.y + t.h / 2, t.y + t.h)
  }

  let bestX: { d: number; pos: number } | null = null
  let bestY: { d: number; pos: number } | null = null
  for (const tx of xs) {
    for (const ax of anchorsOf(move)) {
      const d = Math.abs(tx - ax)
      if (d <= threshold && (!bestX || d < bestX.d)) bestX = { d, pos: tx }
    }
  }
  for (const ty of ys) {
    for (const ay of anchorsOfY(move)) {
      const d = Math.abs(ty - ay)
      if (d <= threshold && (!bestY || d < bestY.d)) bestY = { d, pos: ty }
    }
  }

  const lines: SnapLine[] = []
  let x = move.x
  let y = move.y
  if (bestX) {
    x = move.x + (bestX.pos - nearestAnchor(move.x, move.w, bestX.pos))
    lines.push({ axis: 'v', pos: bestX.pos })
  }
  if (bestY) {
    y = move.y + (bestY.pos - nearestAnchor(move.y, move.h, bestY.pos))
    lines.push({ axis: 'h', pos: bestY.pos })
  }
  return { x, y, lines }
}

function anchorsOf(r: SnapRect): number[] {
  return [r.x, r.x + r.w / 2, r.x + r.w]
}

function anchorsOfY(r: SnapRect): number[] {
  return [r.y, r.y + r.h / 2, r.y + r.h]
}

/** 拖动矩形上最接近目标线的对齐锚点值（用于计算需要移动的位移） */
function nearestAnchor(pos: number, size: number, targetPos: number): number {
  const anchors = [pos, pos + size / 2, pos + size]
  let best = anchors[0]
  for (const a of anchors) {
    if (Math.abs(a - targetPos) < Math.abs(best - targetPos)) best = a
  }
  return best
}
