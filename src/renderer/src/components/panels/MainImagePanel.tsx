import type { MainImageConfig } from '@shared/layout'
import { useLocale } from '../../hooks/useLocale'

interface MainImagePanelProps {
  mainImage: MainImageConfig
  onChange: (patch: Partial<MainImageConfig>) => void
}

export function MainImagePanel({ mainImage, onChange }: MainImagePanelProps): React.JSX.Element {
  const { t } = useLocale()
  return (
    <section className="panel-section">
      <h2>{t('mainImage.title')}</h2>
      <label className="field">
        <span>{t('mainImage.fillMode')}</span>
        <select
          value={mainImage.fillMode}
          onChange={(e) => onChange({ fillMode: e.target.value as MainImageConfig['fillMode'] })}
        >
          <option value="contain">{t('mainImage.contain')}</option>
          <option value="cover">{t('mainImage.cover')}</option>
          <option value="stretch">{t('mainImage.stretch')}</option>
        </select>
      </label>
    </section>
  )
}
