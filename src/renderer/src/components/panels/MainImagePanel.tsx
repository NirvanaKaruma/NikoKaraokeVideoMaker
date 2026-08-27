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
          <option value="contain">等比适配</option>
          <option value="cover">等比铺满</option>
          <option value="stretch">拉伸填满</option>
        </select>
      </label>
    </section>
  )
}
