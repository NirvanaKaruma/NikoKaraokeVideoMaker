import { useLocale } from '../hooks/useLocale'

interface HelpDialogProps {
  open: boolean
  onClose: () => void
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="help-section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

/** 内置使用帮助对话框（T24）：基本流程 + ffmpeg 三源说明 + FAQ */
export function HelpDialog({ open, onClose }: HelpDialogProps): React.JSX.Element | null {
  const { t } = useLocale()
  if (!open) return null
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('help.title')}</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body">
          <Section title={t('help.basics')}>
            <ol className="help-list">
              <li>{t('help.basicsStep1')}</li>
              <li>{t('help.basicsStep2')}</li>
              <li>{t('help.basicsStep3')}</li>
              <li>{t('help.basicsStep4')}</li>
              <li>{t('help.basicsStep5')}</li>
            </ol>
          </Section>

          <Section title={t('help.sources')}>
            <ul className="help-list">
              <li>
                <b>{t('help.sourceSystemLabel')}</b>
                {': '}
                {t('help.sourceSystemDesc')}
              </li>
              <li>
                <b>{t('help.sourceManagedLabel')}</b>
                {': '}
                {t('help.sourceManagedDesc')}
              </li>
              <li>
                <b>{t('help.sourceCustomLabel')}</b>
                {': '}
                {t('help.sourceCustomDesc')}
              </li>
            </ul>
            <p className="panel-note">{t('help.sourcesNote')}</p>
          </Section>

          <Section title={t('help.exportTitle')}>
            <ul className="help-list">
              <li>{t('help.exportRes')}</li>
              <li>{t('help.exportContent')}</li>
              <li>{t('help.exportGpu')}</li>
              <li>{t('help.exportCancel')}</li>
            </ul>
          </Section>

          <Section title={t('help.projectTitle')}>
            <ul className="help-list">
              <li>{t('help.projectSave')}</li>
              <li>{t('help.projectOpen')}</li>
              <li>{t('help.projectNew')}</li>
            </ul>
          </Section>

          <Section title={t('help.faqTitle')}>
            <ul className="help-list">
              <li>
                <b>{t('help.faqNoNetLabel')}</b> {t('help.faqNoNetBody')}
              </li>
              <li>
                <b>{t('help.faqSmartLabel')}</b> {t('help.faqSmartBody')}
              </li>
              <li>
                <b>{t('help.faqTransparentLabel')}</b> {t('help.faqTransparentBody')}
              </li>
              <li>
                <b>{t('help.faq4kLabel')}</b> {t('help.faq4kBody')}
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  )
}
