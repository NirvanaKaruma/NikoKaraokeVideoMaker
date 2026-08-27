import { useState } from 'react'
import type { VisualizerConfig } from '@shared/layout'
import { useLocale } from '../../hooks/useLocale'
import { DeferredSlider } from '../DeferredSlider'

const BUILTIN_PRESETS: { labelKey: string; colors: string[] }[] = [
  { labelKey: 'visualizer.pickPinkCyan', colors: ['#ff5f9e', '#7ce3ff'] },
  { labelKey: 'visualizer.pickCyanViolet', colors: ['#7ce3ff', '#a78bfa'] },
  { labelKey: 'visualizer.pickWarmRed', colors: ['#fbbf24', '#f43f5e'] },
  { labelKey: 'visualizer.pickWhite', colors: ['#ffffff'] },
  { labelKey: 'visualizer.pickGreenYellow', colors: ['#34d399', '#fde047'] }
]

const CUSTOM_PRESETS_KEY = 'niko.viz.customPresets.v1'

/** 频率范围快捷预置（对数刻度）：柱群整体覆盖的频率窗口 */
const FREQ_PRESETS: { labelKey: string; freqMin: number; freqMax: number }[] = [
  { labelKey: 'visualizer.presetFull', freqMin: 30, freqMax: 16000 },
  { labelKey: 'visualizer.presetCommon', freqMin: 30, freqMax: 8000 },
  { labelKey: 'visualizer.presetMidLow', freqMin: 30, freqMax: 4000 },
  { labelKey: 'visualizer.presetBass', freqMin: 20, freqMax: 1000 }
]

const keyOf = (colors: string[]): string => JSON.stringify(colors)

function isValidHex(c: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(c)
}

function parseGradient(text: string): string[] | null {
  const parts = text
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (parts.length < 1 || parts.length > 8) return null
  if (!parts.every(isValidHex)) return null
  return parts
}

function loadCustomPresets(): string[][] {
  try {
    const raw = localStorage.getItem(CUSTOM_PRESETS_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (p): p is string[] =>
        Array.isArray(p) && p.length > 0 && p.every((c) => typeof c === 'string' && isValidHex(c))
    )
  } catch {
    return []
  }
}

function saveCustomPresets(presets: string[][]): void {
  try {
    localStorage.setItem(CUSTOM_PRESETS_KEY, JSON.stringify(presets))
  } catch {
    /* 忽略存储失败 */
  }
}

interface VisualizerPanelProps {
  config: VisualizerConfig
  onChange: (patch: Partial<VisualizerConfig>) => void
}

/** 可视化参数面板（T13）：柱数/柱宽/高度/圆角/平滑/灵敏度/配色（含自定义渐变预置） */
export function VisualizerPanel({ config, onChange }: VisualizerPanelProps): React.JSX.Element {
  const { t } = useLocale()
  const [customPresets, setCustomPresets] = useState<string[][]>(() => loadCustomPresets())
  const [gradientText, setGradientText] = useState<string>(config.colors.join(', '))
  const [gradientError, setGradientError] = useState<string | null>(null)

  const allPresets: {
    labelKey: string
    labelParams?: Record<string, number>
    colors: string[]
    custom?: boolean
    index?: number
  }[] = [
    ...BUILTIN_PRESETS.map((p) => ({ labelKey: p.labelKey, colors: p.colors })),
    ...customPresets.map((colors, i) => ({
      labelKey: 'visualizer.customGradientOption',
      labelParams: { i: i + 1 },
      colors,
      custom: true,
      index: i
    }))
  ]
  const currentKey = keyOf(config.colors)
  const currentPreset = allPresets.find((p) => keyOf(p.colors) === currentKey)

  const applyGradient = (): void => {
    const parsed = parseGradient(gradientText)
    if (!parsed) {
      setGradientError(t('visualizer.gradientError'))
      return
    }
    setGradientError(null)
    onChange({ colors: parsed })
  }

  const saveAsPreset = (): void => {
    if (config.colors.length === 0) return
    const next = [...customPresets, [...config.colors]]
    setCustomPresets(next)
    saveCustomPresets(next)
  }

  const removePreset = (index: number): void => {
    const next = customPresets.filter((_, i) => i !== index)
    setCustomPresets(next)
    saveCustomPresets(next)
  }

  return (
    <section className="panel-section">
      <h2>{t('visualizer.title')}</h2>
      <DeferredSlider
        label={(v) => t('visualizer.barCount', { v })}
        value={config.barCount}
        min={100}
        max={160}
        step={1}
        onCommit={(v) => onChange({ barCount: v })}
      />
      <div className="field">
        <span>{t('visualizer.freqRange', { min: config.freqMin, max: config.freqMax })}</span>
        <DeferredSlider
          label={(v) => t('visualizer.freqMin', { v })}
          value={config.freqMin}
          min={20}
          max={Math.max(21, config.freqMax - 100)}
          step={10}
          onCommit={(v) => onChange({ freqMin: Math.min(Math.round(v), config.freqMax - 100) })}
        />
        <DeferredSlider
          label={(v) => t('visualizer.freqMax', { v })}
          value={config.freqMax}
          min={config.freqMin + 100}
          max={20000}
          step={100}
          onCommit={(v) => onChange({ freqMax: Math.max(Math.round(v), config.freqMin + 100) })}
        />
        <div className="gradient-row">
          {FREQ_PRESETS.map((p) => (
            <button
              key={p.labelKey}
              type="button"
              className="mini-btn"
              disabled={config.freqMin === p.freqMin && config.freqMax === p.freqMax}
              onClick={() => onChange({ freqMin: p.freqMin, freqMax: p.freqMax })}
            >
              {t(p.labelKey)}
            </button>
          ))}
        </div>
        <p className="panel-note">{t('visualizer.freqNote')}</p>
      </div>
      <DeferredSlider
        label={(v) => t('visualizer.barWidth', { v: Math.round(v * 100) })}
        value={config.barWidthRatio}
        min={0.1}
        max={0.9}
        step={0.01}
        onCommit={(v) => onChange({ barWidthRatio: v })}
      />
      <DeferredSlider
        label={(v) => t('visualizer.maxHeight', { v: Math.round(v * 100) })}
        value={config.heightRatio}
        min={0.2}
        max={1}
        step={0.01}
        onCommit={(v) => onChange({ heightRatio: v })}
      />
      <DeferredSlider
        label={(v) => t('visualizer.roundness', { v })}
        value={config.roundness}
        min={0}
        max={24}
        step={1}
        onCommit={(v) => onChange({ roundness: v })}
      />
      <DeferredSlider
        label={(v) => t('visualizer.smoothing', { v: Math.round(v * 100) })}
        value={config.smoothing}
        min={0}
        max={0.9}
        step={0.01}
        onCommit={(v) => onChange({ smoothing: v })}
      />
      <DeferredSlider
        label={(v) => t('visualizer.sensitivity', { v })}
        value={config.sensitivity}
        min={1}
        max={15}
        step={1}
        onCommit={(v) => onChange({ sensitivity: v })}
      />
      <label className="field">
        <span>{t('visualizer.colors')}</span>
        <select
          value={currentPreset ? currentKey : '__custom__'}
          onChange={(e) => {
            const p = allPresets.find((x) => keyOf(x.colors) === e.target.value)
            if (p) {
              onChange({ colors: [...p.colors] })
              setGradientText(p.colors.join(', '))
              setGradientError(null)
            }
          }}
        >
          {BUILTIN_PRESETS.map((p) => (
            <option key={p.labelKey} value={keyOf(p.colors)}>
              {t(p.labelKey)}
            </option>
          ))}
          {allPresets
            .filter((p) => p.custom)
            .map((p) => (
              <option key={keyOf(p.colors)} value={keyOf(p.colors)}>
                {t(p.labelKey, p.labelParams)}
              </option>
            ))}
          {!currentPreset && <option value="__custom__">{t('visualizer.customUnnamed')}</option>}
        </select>
      </label>
      <div className="field">
        <span>{t('visualizer.customGradient')}</span>
        <div className="gradient-row">
          <input
            type="text"
            value={gradientText}
            onChange={(e) => setGradientText(e.target.value)}
            placeholder="#ff0000, #00ff00"
          />
          <button type="button" className="mini-btn" onClick={applyGradient}>
            {t('visualizer.apply')}
          </button>
          <button type="button" className="mini-btn" onClick={saveAsPreset}>
            {t('visualizer.saveAsPreset')}
          </button>
        </div>
        {gradientError && <p className="field-error">{gradientError}</p>}
        {currentPreset?.custom && (
          <div className="gradient-row">
            <button
              type="button"
              className="mini-btn danger"
              onClick={() => removePreset(currentPreset.index ?? 0)}
            >
              {t('visualizer.deletePreset')}
            </button>
          </div>
        )}
      </div>
    </section>
  )
}
