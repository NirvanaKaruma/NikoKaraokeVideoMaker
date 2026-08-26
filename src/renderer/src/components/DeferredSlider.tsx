import { useState } from 'react'

interface DeferredSliderProps {
  /** 标签渲染（参数为当前显示值——拖动中显示草稿、提交后显示真值） */
  label: (v: number) => string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onCommit: (v: number) => void
}

/**
 * 延迟提交滑块（性能优化）：拖动过程中只更新本地草稿（仅标签重渲染），
 * 松开鼠标 / 键盘操作结束 / 失焦时才把值提交给父级触发画布重绘。
 */
export function DeferredSlider(props: DeferredSliderProps): React.JSX.Element {
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? props.value

  const commit = (): void => {
    if (draft != null) {
      props.onCommit(draft)
      setDraft(null)
    }
  }

  return (
    <label className="field">
      <span>{props.label(shown)}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={shown}
        disabled={props.disabled}
        onChange={(e) => setDraft(Number(e.target.value))}
        onPointerUp={commit}
        onPointerCancel={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
    </label>
  )
}
