import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYOUT,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
  RESOLUTIONS,
  clampNormRect,
  normToPixel,
  pixelToNorm,
  sanitizeNormRect
} from './layout'

describe('归一化布局模型', () => {
  it('DEFAULT_LAYOUT 所有矩形都在 0–1 范围内且尺寸为正', () => {
    const rects = [
      DEFAULT_LAYOUT.mainImage.rect,
      DEFAULT_LAYOUT.texts.songTitle.rect,
      DEFAULT_LAYOUT.texts.artist.rect,
      DEFAULT_LAYOUT.visualizer.rect
    ]
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(1.0001)
      expect(r.y + r.h).toBeLessThanOrEqual(1.0001)
      expect(r.w).toBeGreaterThan(0)
      expect(r.h).toBeGreaterThan(0)
    }
  })

  it('可视化柱数默认 128，位于规格区间 100–160', () => {
    expect(DEFAULT_LAYOUT.visualizer.barCount).toBe(128)
    expect(DEFAULT_LAYOUT.visualizer.barCount).toBeGreaterThanOrEqual(100)
    expect(DEFAULT_LAYOUT.visualizer.barCount).toBeLessThanOrEqual(160)
  })

  it('可视化灵敏度默认 7（用户反馈原增益偏低）', () => {
    expect(DEFAULT_LAYOUT.visualizer.sensitivity).toBe(7)
  })

  it('导出默认 1080p@30fps，RESOLUTIONS 提供 4 档 16:9', () => {
    expect(DEFAULT_LAYOUT.export.resolutionId).toBe('1080p')
    expect(DEFAULT_LAYOUT.export.fps).toBe(30)
    expect(RESOLUTIONS).toHaveLength(4)
    for (const r of RESOLUTIONS) {
      expect(r.width / r.height).toBeCloseTo(16 / 9, 5)
    }
    expect(RESOLUTIONS.some((r) => r.id === '4k' && r.width === 3840)).toBe(true)
  })

  it('背景默认使用封面图（用户反馈：可额外上传独立背景图）', () => {
    expect(DEFAULT_LAYOUT.background.imageSource).toBe('cover')
  })

  it('主图默认填充模式为等比适配 contain（用户确认）', () => {
    expect(DEFAULT_LAYOUT.mainImage.fillMode).toBe('contain')
  })

  it('主图默认高≈90%、宽≈40%，左侧垂直居中（上移后 y=3%）', () => {
    const r = DEFAULT_LAYOUT.mainImage.rect
    expect(r.h).toBeCloseTo(0.9, 5)
    expect(r.w).toBeCloseTo(0.38, 5)
    expect(r.y).toBeCloseTo(0.03, 5)
    expect(r.x).toBeLessThan(0.1)
  })

  it('文本与可视化区域符合默认坐标（§4 基础上整体上移 2%）', () => {
    expect(DEFAULT_LAYOUT.texts.songTitle.rect.x).toBeCloseTo(0.54, 5)
    expect(DEFAULT_LAYOUT.texts.songTitle.rect.y).toBeCloseTo(0.13, 5)
    expect(DEFAULT_LAYOUT.texts.artist.rect.y).toBeGreaterThan(
      DEFAULT_LAYOUT.texts.songTitle.rect.y
    )
    const v = DEFAULT_LAYOUT.visualizer.rect
    expect(v.x).toBeCloseTo(0.49, 5)
    expect(v.x + v.w).toBeCloseTo(0.97, 5)
    expect(v.y + v.h / 2).toBeCloseTo(0.47, 5)
  })

  it('normToPixel / pixelToNorm 往返一致', () => {
    const rect = { x: 0.25, y: 0.3, w: 0.4, h: 0.2 }
    const canvas = { width: LOGICAL_WIDTH, height: LOGICAL_HEIGHT }
    const round = pixelToNorm(normToPixel(rect, canvas), canvas)
    expect(round.x).toBeCloseTo(rect.x, 9)
    expect(round.y).toBeCloseTo(rect.y, 9)
    expect(round.w).toBeCloseTo(rect.w, 9)
    expect(round.h).toBeCloseTo(rect.h, 9)
  })

  it('clampNormRect 把越界矩形拉回画布内', () => {
    const out = clampNormRect({ x: -0.5, y: 2, w: 0.4, h: 0.3 })
    expect(out.x).toBe(0)
    expect(out.y).toBeCloseTo(0.7, 9)
    const tooBig = clampNormRect({ x: 0, y: 0, w: 5, h: 3 })
    expect(tooBig.w).toBe(1)
    expect(tooBig.h).toBe(1)
  })

  it('sanitizeNormRect 容忍非法输入', () => {
    const s = sanitizeNormRect({ x: NaN, y: Infinity, w: -1, h: 0 })
    expect(s.x).toBe(0)
    expect(s.y).toBe(0)
    expect(s.w).toBeGreaterThan(0)
    expect(s.h).toBeGreaterThan(0)
  })
})
