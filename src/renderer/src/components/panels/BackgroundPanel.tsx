import type { BackgroundConfig } from '@shared/layout'

interface BackgroundPanelProps {
  background: BackgroundConfig
  onChange: (patch: Partial<BackgroundConfig>) => void
}

export function BackgroundPanel({ background, onChange }: BackgroundPanelProps): React.JSX.Element {
  return (
    <section className="panel-section">
      <h2>背景</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={background.useImage}
          onChange={(e) => onChange({ useImage: e.target.checked })}
        />
        <span>使用封面图铺满（关闭 = 纯色背景）</span>
      </label>
      <label className="field">
        <span>背景色（透明图先与此色合成再模糊）</span>
        <input
          type="color"
          value={background.color}
          onChange={(e) => onChange({ color: e.target.value })}
        />
      </label>
      <label className="field">
        <span>高斯模糊：{background.blur}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={background.blur}
          disabled={!background.useImage}
          onChange={(e) => onChange({ blur: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>压暗：{Math.round(background.dimOpacity * 100)}%</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(background.dimOpacity * 100)}
          onChange={(e) => onChange({ dimOpacity: Number(e.target.value) / 100 })}
        />
      </label>
      <p className="panel-note">
        提示：点选主图后可拖动、拖角缩放（等比锁定）；拖入下半区（y&gt;55%，预留字幕区）仅提醒不禁止。
      </p>
    </section>
  )
}
