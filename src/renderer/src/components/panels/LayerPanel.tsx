import { useLocale } from '../../hooks/useLocale'

export interface LayerRow {
  id: string
  /** 名称 key（i18n） */
  nameKey: string
  /** 名称参数（附加层序号等） */
  nameArg?: Record<string, string | number>
  hidden: boolean
  locked: boolean
}

interface LayerPanelProps {
  rows: LayerRow[]
  snapEnabled: boolean
  onToggleHidden: (id: string) => void
  onToggleLocked: (id: string) => void
  onMove: (id: string, dir: -1 | 1) => void
  onSnapToggle: (v: boolean) => void
}

/** 图层面板（0.9.0）：z 序（↑↓）/ 隐藏（👁）/ 锁定（🔒）；吸附开关也在本页。 */
export function LayerPanel(props: LayerPanelProps): React.JSX.Element {
  const { t } = useLocale()
  return (
    <section className="panel-section">
      <h2>{t('layers.tab')}</h2>
      <label className="check-row">
        <input
          type="checkbox"
          checked={props.snapEnabled}
          onChange={(e) => props.onSnapToggle(e.target.checked)}
        />
        <span>{t('layers.snap')}</span>
      </label>
      <p className="panel-note">{t('layers.snapEnabled')}</p>
      {props.rows.map((r, i) => (
        <div key={r.id} className={'overlay-row' + (r.locked ? ' locked' : '')}>
          <span className="overlay-name">
            {t(r.nameKey, r.nameArg)}
            {r.locked ? ' 🔒' : ''}
          </span>
          <span className="overlay-actions">
            <button
              type="button"
              title={r.hidden ? t('layers.hideOff') : t('layers.hide')}
              onClick={() => props.onToggleHidden(r.id)}
            >
              {r.hidden ? '👁️‍🗨️' : '👁'}
            </button>
            <button
              type="button"
              title={r.locked ? t('layers.lockOff') : t('layers.lock')}
              onClick={() => props.onToggleLocked(r.id)}
            >
              {r.locked ? '🔓' : '🔒'}
            </button>
            <button
              type="button"
              title={t('layers.moveUp')}
              disabled={i === 0}
              onClick={() => props.onMove(r.id, -1)}
            >
              ↑
            </button>
            <button
              type="button"
              title={t('layers.moveDown')}
              disabled={i === props.rows.length - 1}
              onClick={() => props.onMove(r.id, 1)}
            >
              ↓
            </button>
          </span>
        </div>
      ))}
      <p className="panel-note">{t('layers.note')}</p>
    </section>
  )
}
