import { useState } from 'react'
import type { VisualizerConfig } from '@shared/layout'
import { DeferredSlider } from '../DeferredSlider'

const BUILTIN_PRESETS: { label: string; colors: string[] }[] = [
  { label: '粉→青（默认）', colors: ['#ff5f9e', '#7ce3ff'] },
  { label: '青→紫', colors: ['#7ce3ff', '#a78bfa'] },
  { label: '暖阳橙→红', colors: ['#fbbf24', '#f43f5e'] },
  { label: '纯白', colors: ['#ffffff'] },
  { label: '绿→黄', colors: ['#34d399', '#fde047'] }
]

const CUSTOM_PRESETS_KEY = 'niko.viz.customPresets.v1'

/** 频率范围快捷预置（对数刻度）：柱群整体覆盖的频率窗口 */
const FREQ_PRESETS: { label: string; freqMin: number; freqMax: number }[] = [
  { label: '全频段 30–16k', freqMin: 30, freqMax: 16000 },
  { label: '常用 30–8k', freqMin: 30, freqMax: 8000 },
  { label: '中低频 30–4k', freqMin: 30, freqMax: 4000 },
  { label: '鼓点/贝斯 20–1k', freqMin: 20, freqMax: 1000 }
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
  const [customPresets, setCustomPresets] = useState<string[][]>(() => loadCustomPresets())
  const [gradientText, setGradientText] = useState<string>(config.colors.join(', '))
  const [gradientError, setGradientError] = useState<string | null>(null)

  const allPresets: { label: string; colors: string[]; custom?: boolean; index?: number }[] = [
    ...BUILTIN_PRESETS.map((p) => ({ label: p.label, colors: p.colors })),
    ...customPresets.map((colors, i) => ({
      label: '自定义渐变 ' + (i + 1),
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
      setGradientError('格式：1–8 个十六进制色、逗号分隔，如 #ff0000,#00ff00')
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
      <h2>音频可视化</h2>
      <DeferredSlider
        label={(v) => '柱数：' + v + '（100–160，频率范围不变，柱越多分度越细）'}
        value={config.barCount}
        min={100}
        max={160}
        step={1}
        onCommit={(v) => onChange({ barCount: v })}
      />
      <div className="field">
        <span>
          显示频率范围：{config.freqMin}–{config.freqMax} Hz（对数刻度）
        </span>
        <DeferredSlider
          label={(v) => '最低频率：' + v + ' Hz'}
          value={config.freqMin}
          min={20}
          max={Math.max(21, config.freqMax - 100)}
          step={10}
          onCommit={(v) => onChange({ freqMin: Math.min(Math.round(v), config.freqMax - 100) })}
        />
        <DeferredSlider
          label={(v) => '最高频率：' + v + ' Hz'}
          value={config.freqMax}
          min={config.freqMin + 100}
          max={20000}
          step={100}
          onCommit={(v) => onChange({ freqMax: Math.max(Math.round(v), config.freqMin + 100) })}
        />
        <div className="gradient-row">
          {FREQ_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className="mini-btn"
              disabled={config.freqMin === p.freqMin && config.freqMax === p.freqMax}
              onClick={() => onChange({ freqMin: p.freqMin, freqMax: p.freqMax })}
            >
              {p.label}
            </button>
          ))}
        </div>
        <p className="panel-note">
          左端=低频（鼓/贝斯），右端=高频（镲片/人声泛音）。音乐能量集中在低频，若右侧柱几乎不动，减小上限即可让柱子布满整个区域；上限受音频采样率限制。
        </p>
      </div>
      <DeferredSlider
        label={(v) => '柱宽：' + Math.round(v * 100) + '%'}
        value={config.barWidthRatio}
        min={0.1}
        max={0.9}
        step={0.01}
        onCommit={(v) => onChange({ barWidthRatio: v })}
      />
      <DeferredSlider
        label={(v) => '柱最大高度：' + Math.round(v * 100) + '%'}
        value={config.heightRatio}
        min={0.2}
        max={1}
        step={0.01}
        onCommit={(v) => onChange({ heightRatio: v })}
      />
      <DeferredSlider
        label={(v) => '柱顶圆角：' + v + 'px'}
        value={config.roundness}
        min={0}
        max={24}
        step={1}
        onCommit={(v) => onChange({ roundness: v })}
      />
      <DeferredSlider
        label={(v) => '平滑：' + Math.round(v * 100) + '%（0 = 最灵敏，默认 20%）'}
        value={config.smoothing}
        min={0}
        max={0.9}
        step={0.01}
        onCommit={(v) => onChange({ smoothing: v })}
      />
      <DeferredSlider
        label={(v) => '灵敏度：' + v + '（越大柱越高越灵敏）'}
        value={config.sensitivity}
        min={1}
        max={15}
        step={1}
        onCommit={(v) => onChange({ sensitivity: v })}
      />
      <label className="field">
        <span>配色方案</span>
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
            <option key={p.label} value={keyOf(p.colors)}>
              {p.label}
            </option>
          ))}
          {customPresets.map((colors, i) => (
            <option key={'custom-' + i} value={keyOf(colors)}>
              自定义渐变 {i + 1}
            </option>
          ))}
          {!currentPreset && <option value="__custom__">自定义（未命名）</option>}
        </select>
      </label>
      <div className="field">
        <span>自定义渐变（1–8 个 hex，逗号分隔）</span>
        <div className="gradient-row">
          <input
            type="text"
            value={gradientText}
            onChange={(e) => setGradientText(e.target.value)}
            placeholder="#ff0000, #00ff00"
          />
          <button type="button" className="mini-btn" onClick={applyGradient}>
            应用
          </button>
          <button type="button" className="mini-btn" onClick={saveAsPreset}>
            存为预置
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
              ✕ 删除当前自定义预置
            </button>
          </div>
        )}
        <p className="panel-note">
          单色 = 只填 1 个色；多色从左到右线性渐变。自定义预置保存在本机。
        </p>
      </div>
    </section>
  )
}
