import type { MainImageConfig } from '@shared/layout'

interface MainImagePanelProps {
  mainImage: MainImageConfig
  onChange: (patch: Partial<MainImageConfig>) => void
}

export function MainImagePanel({ mainImage, onChange }: MainImagePanelProps): React.JSX.Element {
  return (
    <section className="panel-section">
      <h2>主图</h2>
      <label className="field">
        <span>填充方式</span>
        <select
          value={mainImage.fillMode}
          onChange={(e) => onChange({ fillMode: e.target.value as MainImageConfig['fillMode'] })}
        >
          <option value="contain">等比适配（完整显示，留透明边）</option>
          <option value="cover">等比铺满（填满矩形，裁掉多余）</option>
          <option value="stretch">拉伸填满（可能变形）</option>
        </select>
      </label>
      <p className="panel-note">
        等比适配：图片永不变形、完整可见；矩形与图片比例不一致时，空白处透明（透出模糊背景）。
      </p>
    </section>
  )
}
