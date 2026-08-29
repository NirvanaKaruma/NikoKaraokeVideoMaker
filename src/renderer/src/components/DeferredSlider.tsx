import { useState } from 'react'
import { formatSliderValue, nudgeSliderValue, parseSliderInput } from '@shared/slider'

interface DeferredSliderProps {
  /** 标签渲染（参数为当前显示值——拖动中显示草稿、提交后显示真值） */
  label: (v: number) => string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  /** 0.9.0 数字框：显示值 = 模型值 × unitScale（百分比=100；秒/度/毫秒=1 缺省） */
  unitScale?: number
  onCommit: (v: number) => void
}

/**
 * 延迟提交滑块（性能优化）：拖动过程中只更新本地草稿（仅标签重渲染），
 * 松开鼠标 / 键盘操作结束 / 失焦时才把值提交给父级触发画布重绘。
 * 0.9.0：右侧新增数字输入框（显示单位值，↑/↓ 步进微调，Shift×10，回车/失焦提交；同步钳制）。
 */
export function DeferredSlider(props: DeferredSliderProps): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const [text, setText] = useState<string | null>(null)
  const unit = props.unitScale ?? 1
  const step = props.step ?? 0.01
  const shown = draft ?? props.value
  const shownText = text ?? formatSliderValue(shown, unit, step)

  const commit = (): void => {
    if (draft != null) {
      props.onCommit(draft)
      setDraft(null)
    }
  }

  const commitText = (): void => {
    if (text != null) {
      const v = parseSliderInput(text, unit, props.min, props.max)
      if (v != null) {
        props.onCommit(v)
      }
      setText(null) // 提交或非法输入都回退显示
    }
  }

  const nudge = (times: number): void => {
    const next = Math.min(
      Math.max(nudgeSliderValue(props.value, unit, step, times), props.min),
      props.max
    )
    setText(formatSliderValue(next, unit, step))
    props.onCommit(next)
  }

  return (
    <label className="field">
      <span>{props.label(shown)}</span>
      <div className="slider-row">
        <input
          type="range"
          min={props.min}
          max={props.max}
          step={step}
          value={shown}
          disabled={props.disabled}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onPointerCancel={commit}
          onKeyUp={commit}
          onBlur={commit}
        />
        <input
          type="number"
          className="slider-num"
          value={shownText}
          step={step * unit}
          min={props.min * unit}
          max={props.max * unit}
          disabled={props.disabled}
          onChange={(e) => setText(e.currentTarget.value)}
          onBlur={commitText}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitText()
            } else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault()
              nudge(e.key === 'ArrowUp' ? (e.shiftKey ? 10 : 1) : e.shiftKey ? -10 : -1)
            }
          }}
        />
      </div>
    </label>
  )
}
