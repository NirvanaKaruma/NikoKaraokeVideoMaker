import { useRef, useState } from 'react'
import type { BackgroundConfig } from '@shared/layout'
import { DeferredSlider } from '../DeferredSlider'

interface BackgroundPanelProps {
  background: BackgroundConfig
  bgUrl: string | null
  bgFile: File | null
  onChange: (patch: Partial<BackgroundConfig>) => void
  onBgFile: (f: File | null) => void
  onClearBg: () => void
}

/** 背景设置：默认用封面图；可额外上传独立背景图，并一键恢复默认（用户反馈） */
export function BackgroundPanel(props: BackgroundPanelProps): React.JSX.Element {
  const { background, bgUrl, bgFile, onChange, onBgFile, onClearBg } = props
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <section className="panel-section">
      <h2>背景</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={background.useImage}
          onChange={(e) => onChange({ useImage: e.target.checked })}
        />
        <span>使用图片背景（关闭 = 纯色背景）</span>
      </label>
      <label className="field">
        <span>背景图片来源</span>
        <select
          value={background.imageSource}
          onChange={(e) =>
            onChange({ imageSource: e.target.value as BackgroundConfig['imageSource'] })
          }
        >
          <option value="cover">封面图（默认）</option>
          <option value="custom">自定义图片（独立上传）</option>
        </select>
      </label>
      {background.imageSource === 'custom' && (
        <div className="field">
          <span>自定义背景图（png / jpg / webp）</span>
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
              <span className="drop-hint">＋ 上传背景图</span>
            )}
            <span className="drop-file">{bgFile ? bgFile.name : '点击或拖入图片'}</span>
          </div>
          <div className="gradient-row">
            <button type="button" className="mini-btn danger" onClick={onClearBg}>
              ✕ 清除自定义图（恢复用封面图）
            </button>
          </div>
        </div>
      )}
      <label className="field">
        <span>背景色（透明图先与此色合成再模糊）</span>
        <input
          type="color"
          value={background.color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>
      <DeferredSlider
        label={(v) => '高斯模糊：' + v}
        value={background.blur}
        min={0}
        max={100}
        disabled={!background.useImage}
        onCommit={(v) => onChange({ blur: v })}
      />
      <DeferredSlider
        label={(v) => '压暗：' + Math.round(v * 100) + '%'}
        value={background.dimOpacity}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => onChange({ dimOpacity: v })}
      />
      <p className="panel-note">
        提示：点选主图后可拖动、拖角缩放（等比锁定）；拖入下半区（y&gt;55%，预留字幕区）仅提醒不禁止。
      </p>
    </section>
  )
}
