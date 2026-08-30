import { useRef, useState } from 'react'
import type { BackgroundConfig } from '@shared/layout'
import { useLocale } from '../../hooks/useLocale'
import { DeferredSlider } from '../DeferredSlider'

interface BackgroundPanelProps {
  background: BackgroundConfig
  bgUrl: string | null
  bgFile: File | null
  onChange: (patch: Partial<BackgroundConfig>) => void
  /** P3b 菱形打帧入口 */
  kfOps?: {
    hasKeyframe: (path: string) => boolean
    addKeyframeAt: (path: string) => void
  }
  onBgFile: (f: File | null) => void
  onClearBg: () => void
}

/** 背景设置：默认用封面图；可额外上传独立背景图，并一键恢复默认（用户反馈） */
export function BackgroundPanel(props: BackgroundPanelProps): React.JSX.Element {
  const { kfOps } = props
  const { t } = useLocale()
  const { background, bgUrl, bgFile, onChange, onBgFile, onClearBg } = props
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="panel-section">
      <h2>{t('background.title')}</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={background.useImage}
          onChange={(e) => onChange({ useImage: e.target.checked })}
        />
        <span>{t('background.useImage')}</span>
      </label>
      <label className="field">
        <span>{t('background.source')}</span>
        <select
          value={background.imageSource}
          onChange={(e) =>
            onChange({ imageSource: e.target.value as BackgroundConfig['imageSource'] })
          }
        >
          <option value="cover">{t('background.sourceCover')}</option>
          <option value="custom">{t('background.sourceCustom')}</option>
        </select>
      </label>
      {background.imageSource === 'custom' && (
        <div className="field">
          <span>{t('background.customImage')}</span>
          <div
            className={'drop-zone' + (over ? ' over' : '')}
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              onBgFile(e.dataTransfer.files?.[0] ?? null)
            }}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
              hidden
              onChange={(e) => {
                onBgFile(e.target.files?.[0] ?? null)
                e.target.value = ''
              }}
            />
            {bgUrl ? (
              <img src={bgUrl} alt="背景预览" className="drop-preview" />
            ) : (
              <span className="drop-hint">{t('background.uploadHint')}</span>
            )}
            <span className="drop-file">{bgFile ? bgFile.name : t('background.dropOrClick')}</span>
          </div>
          <div className="gradient-row">
            <button type="button" className="mini-btn danger" onClick={onClearBg}>
              {t('background.clearCustom')}
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>{t('background.color')}</span>
        <input
          type="color"
          value={background.color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>
      <DeferredSlider
        label={(v) => t('background.blur', { v })}
        value={background.blur}
        min={0}
        max={100}
        disabled={!background.useImage}
        kfPath="background.blur"
        kfHas={kfOps?.hasKeyframe('background.blur')}
        onKfAdd={kfOps?.addKeyframeAt}
        onCommit={(v) => onChange({ blur: v })}
      />
      <DeferredSlider
        label={(v) => t('background.dim', { v: Math.round(v * 100) })}
        value={background.dimOpacity}
        min={0}
        max={1}
        step={0.01}
        kfPath="background.dimOpacity"
        kfHas={kfOps?.hasKeyframe('background.dimOpacity')}
        onKfAdd={kfOps?.addKeyframeAt}
        onCommit={(v) => onChange({ dimOpacity: v })}
      />
    </section>
  )
}
