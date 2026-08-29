import { useRef, useState } from 'react'
import type { NormRect, OverlayLayerConfig, OverlayEntryType } from '@shared/layout'
import { useLocale } from '../../hooks/useLocale'
import { DeferredSlider } from '../DeferredSlider'
import type { SelectableId } from '../SceneLayers'

const CORNERS: { key: string; rect: NormRect }[] = [
  { key: 'overlay.cornerTL', rect: { x: 0.02, y: 0.02, w: 0.2, h: 0.15 } },
  { key: 'overlay.cornerTR', rect: { x: 0.78, y: 0.02, w: 0.2, h: 0.15 } },
  { key: 'overlay.cornerBL', rect: { x: 0.02, y: 0.83, w: 0.2, h: 0.15 } },
  { key: 'overlay.cornerBR', rect: { x: 0.78, y: 0.83, w: 0.2, h: 0.15 } }
]

const ENTRY_TYPES: { value: OverlayEntryType; labelKey: string }[] = [
  { value: 'none', labelKey: 'overlay.entryNone' },
  { value: 'fade', labelKey: 'overlay.entryFade' },
  { value: 'slide', labelKey: 'overlay.entrySlide' },
  { value: 'bounce', labelKey: 'overlay.entryBounce' }
]

const MASKS: { value: OverlayLayerConfig['fx']['mask']; labelKey: string }[] = [
  { value: 'none', labelKey: 'fx.img.maskNone' },
  { value: 'circle', labelKey: 'fx.img.maskCircle' },
  { value: 'star', labelKey: 'fx.img.maskStar' }
]

interface OverlayPanelProps {
  layers: OverlayLayerConfig[]
  /** layerId → 预览 URL（objectURL / dataURL；null = 无图） */
  imageUrls: Record<string, string | null>
  selectedId: SelectableId
  onSelect: (id: SelectableId) => void
  /** 新增图层（返回新 id——随后自动打开文件选择） */
  onAdd: () => string
  onPickImage: (id: string, file: File | null) => void
  onUpdate: (id: string, patch: Partial<OverlayLayerConfig>) => void
  onRemove: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
}

/** 附加图层面板（0.8.0）：多层自由增删（z 序=数组序）+ 透明度/四角摆位 + 完整 fx + 入场动画。 */
export function OverlayPanel(props: OverlayPanelProps): React.JSX.Element {
  const { t } = useLocale()
  const [addingId, setAddingId] = useState<string | null>(null)
  const newFileRef = useRef<HTMLInputElement>(null)
  const selected = props.layers.find((o) => props.selectedId === 'overlay:' + o.id) ?? null

  const handleAdd = (): void => {
    const id = props.onAdd()
    setAddingId(id)
    newFileRef.current?.click()
  }

  return (
    <section className="panel-section">
      <h2>{t('overlay.title')}</h2>
      <button type="button" className="btn" onClick={handleAdd}>
        {t('overlay.add')}
      </button>
      <input
        ref={newFileRef}
        type="file"
        accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null
          if (addingId && f) props.onPickImage(addingId, f)
          setAddingId(null)
          e.target.value = ''
        }}
      />
      {props.layers.length === 0 && <p className="panel-note">{t('overlay.layerEmpty')}</p>}
      {props.layers.map((o, i) => {
        const active = props.selectedId === 'overlay:' + o.id
        return (
          <div
            key={o.id}
            className={'overlay-row' + (active ? ' active' : '')}
            onClick={() => props.onSelect(`overlay:${o.id}`)}
          >
            <span className="overlay-thumb">
              {props.imageUrls[o.id] ? <img src={props.imageUrls[o.id] ?? ''} alt="" /> : '□'}
            </span>
            <span className="overlay-name">{t('overlay.layerI', { i: i + 1 })}</span>
            <span className="overlay-actions">
              <button
                type="button"
                title={t('overlay.moveUp')}
                disabled={i === 0}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onMove(o.id, -1)
                }}
              >
                ↑
              </button>
              <button
                type="button"
                title={t('overlay.moveDown')}
                disabled={i === props.layers.length - 1}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onMove(o.id, 1)
                }}
              >
                ↓
              </button>
              <button
                type="button"
                title={t('overlay.remove')}
                onClick={(e) => {
                  e.stopPropagation()
                  props.onRemove(o.id)
                }}
              >
                🗑
              </button>
            </span>
          </div>
        )
      })}
      {selected && (
        <div className="text-block">
          <label className="field">
            <span>{t('overlay.replaceImage')}</span>
            <input
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              onChange={(e) => {
                props.onPickImage(selected.id, e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
          </label>
          <DeferredSlider
            label={(v) => t('overlay.opacity', { v: Math.round(v * 100) })}
            value={selected.opacity}
            min={0}
            max={1}
            step={0.01}
            onCommit={(v) => props.onUpdate(selected.id, { opacity: v })}
          />
          <div className="field">
            <span>{t('overlay.corners')}</span>
            <div className="overlay-corners">
              {CORNERS.map((c) => (
                <button
                  type="button"
                  key={c.key}
                  className="btn-sm"
                  onClick={() => props.onUpdate(selected.id, { rect: c.rect })}
                >
                  {t(c.key)}
                </button>
              ))}
            </div>
          </div>

          <h3>{t('overlay.fxTitle')}</h3>
          <label className="field">
            <span>{t('fx.img.mask')}</span>
            <select
              value={selected.fx.mask}
              onChange={(e) =>
                props.onUpdate(selected.id, {
                  fx: { ...selected.fx, mask: e.target.value as OverlayLayerConfig['fx']['mask'] }
                })
              }
            >
              {MASKS.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <DeferredSlider
            label={(v) => t('fx.img.border', { v: Math.round(v * 100) })}
            value={selected.fx.border}
            min={0}
            max={0.02}
            step={0.0005}
            onCommit={(v) => props.onUpdate(selected.id, { fx: { ...selected.fx, border: v } })}
          />
          <label className="field">
            <span>{t('fx.img.borderColor')}</span>
            <input
              type="color"
              value={selected.fx.borderColor}
              onInput={(e) =>
                props.onUpdate(selected.id, {
                  fx: { ...selected.fx, borderColor: e.currentTarget.value }
                })
              }
            />
          </label>
          <DeferredSlider
            label={(v) => t('fx.img.breathe', { v: Math.round(v * 100) })}
            value={selected.fx.breathe}
            min={0}
            max={1}
            step={0.01}
            onCommit={(v) => props.onUpdate(selected.id, { fx: { ...selected.fx, breathe: v } })}
          />
          <DeferredSlider
            label={(v) => t('fx.img.breathePeriod', { v: Math.round(v * 10) / 10 })}
            value={selected.fx.breathePeriod}
            min={0.5}
            max={12}
            step={0.5}
            onCommit={(v) =>
              props.onUpdate(selected.id, { fx: { ...selected.fx, breathePeriod: v } })
            }
          />
          <DeferredSlider
            label={(v) => t('fx.img.rotateDeg', { v: Math.round(v * 10) / 10 })}
            value={selected.fx.rotateDeg}
            min={0}
            max={30}
            step={0.5}
            onCommit={(v) => props.onUpdate(selected.id, { fx: { ...selected.fx, rotateDeg: v } })}
          />
          <DeferredSlider
            label={(v) => t('fx.img.glowPulse', { v: Math.round(v * 100) })}
            value={selected.fx.glowPulse}
            min={0}
            max={1}
            step={0.01}
            onCommit={(v) => props.onUpdate(selected.id, { fx: { ...selected.fx, glowPulse: v } })}
          />

          <h3>{t('overlay.entryTitle')}</h3>
          <label className="field">
            <span>{t('overlay.entryType')}</span>
            <select
              value={selected.entry.type}
              onChange={(e) =>
                props.onUpdate(selected.id, {
                  entry: { ...selected.entry, type: e.target.value as OverlayEntryType }
                })
              }
            >
              {ENTRY_TYPES.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.labelKey)}
                </option>
              ))}
            </select>
          </label>
          <DeferredSlider
            label={(v) => t('fx.entry.durationSec', { v: Math.round(v * 10) / 10 })}
            value={selected.entry.durationSec}
            min={0.3}
            max={5}
            step={0.1}
            onCommit={(v) =>
              props.onUpdate(selected.id, { entry: { ...selected.entry, durationSec: v } })
            }
          />
          <DeferredSlider
            label={(v) => t('fx.entry.delaySec', { v: Math.round(v * 10) / 10 })}
            value={selected.entry.delaySec}
            min={0}
            max={3}
            step={0.1}
            onCommit={(v) =>
              props.onUpdate(selected.id, { entry: { ...selected.entry, delaySec: v } })
            }
          />
        </div>
      )}
    </section>
  )
}
