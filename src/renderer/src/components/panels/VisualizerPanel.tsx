import type { VisualizerConfig } from '@shared/layout'

const COLOR_PRESETS: { label: string; colors: string[] }[] = [
  { label: '粉→青（默认）', colors: ['#ff5f9e', '#7ce3ff'] },
  { label: '青→紫', colors: ['#7ce3ff', '#a78bfa'] },
  { label: '暖阳橙→红', colors: ['#fbbf24', '#f43f5e'] },
  { label: '纯白', colors: ['#ffffff'] },
  { label: '绿→黄', colors: ['#34d399', '#fde047'] }
]

const keyOf = (colors: string[]): string => JSON.stringify(colors)

interface VisualizerPanelProps {
  config: VisualizerConfig
  onChange: (patch: Partial<VisualizerConfig>) => void
}

/** 可视化参数面板（T13）：柱数/柱宽/高度/圆角/平滑/配色 */
export function VisualizerPanel({ config, onChange }: VisualizerPanelProps): React.JSX.Element {
  const preset = COLOR_PRESETS.find((p) => keyOf(p.colors) === keyOf(config.colors))
  return (
    <section className="panel-section">
      <h2>音频可视化</h2>
      <label className="field">
        <span>柱数：{config.barCount}（100–160）</span>
        <input
          type="range"
          min={100}
          max={160}
          value={config.barCount}
          onChange={(e) => onChange({ barCount: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>柱宽：{Math.round(config.barWidthRatio * 100)}%</span>
        <input
          type="range"
          min={10}
          max={90}
          value={Math.round(config.barWidthRatio * 100)}
          onChange={(e) => onChange({ barWidthRatio: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="field">
        <span>柱最大高度：{Math.round(config.heightRatio * 100)}%</span>
        <input
          type="range"
          min={20}
          max={100}
          value={Math.round(config.heightRatio * 100)}
          onChange={(e) => onChange({ heightRatio: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="field">
        <span>柱顶圆角：{config.roundness}px</span>
        <input
          type="range"
          min={0}
          max={24}
          value={config.roundness}
          onChange={(e) => onChange({ roundness: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>平滑：{Math.round(config.smoothing * 100)}%（0 = 最灵敏）</span>
        <input
          type="range"
          min={0}
          max={90}
          value={Math.round(config.smoothing * 100)}
          onChange={(e) => onChange({ smoothing: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="field">
        <span>灵敏度：{config.sensitivity}（越大柱越高越灵敏）</span>
        <input
          type="range"
          min={1}
          max={15}
          value={config.sensitivity}
          onChange={(e) => onChange({ sensitivity: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        <span>配色方案</span>
        <select
          value={preset ? keyOf(preset.colors) : '__custom__'}
          onChange={(e) => {
            const p = COLOR_PRESETS.find((x) => keyOf(x.colors) === e.target.value)
            if (p) onChange({ colors: [...p.colors] })
          }}
        >
          {COLOR_PRESETS.map((p) => (
            <option key={p.label} value={keyOf(p.colors)}>
              {p.label}
            </option>
          ))}
          {!preset && <option value="__custom__">自定义（单色，见下方）</option>}
        </select>
      </label>
      <label className="field">
        <span>自定义单色（选择后覆盖配色方案）</span>
        <input
          type="color"
          value={config.colors[0] ?? '#ffffff'}
          onChange={(e) => onChange({ colors: [e.target.value] })}
        />
      </label>
      <p className="panel-note">
        支持单色与多色渐变：多色从左到右线性过渡（可在预设中选渐变方案）。
      </p>
    </section>
  )
}
