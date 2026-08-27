import { useState } from 'react'
import type { FfmpegDetectInfo, FfmpegSource, FfmpegStatusReport } from '@shared/ffmpeg'
import { useLocale } from '../../hooks/useLocale'
import { useFfmpegDownload } from '../../hooks/useFfmpeg'

const SOURCE_LABEL_KEY: Record<FfmpegSource, string> = {
  system: 'ffmpegPanel.sourceSystem',
  managed: 'ffmpegPanel.sourceManaged',
  custom: 'ffmpegPanel.sourceCustom'
}

function InfoRow({
  title,
  info
}: {
  title: string
  info: FfmpegDetectInfo | null
}): React.JSX.Element {
  const { t } = useLocale()
  if (!info) {
    return <p className="panel-note">{t('ffmpegPanel.notDetected', { title })}</p>
  }
  return (
    <div className="ffmpeg-info">
      <span className={'ffmpeg-badge ' + (info.status === 'ok' ? 'ok' : 'bad')}>
        {info.status === 'ok' ? '✓' : '✗'}
      </span>
      <span className="ffmpeg-desc">
        {t('ffmpegPanel.versionSep', { title, version: info.version })}
        {info.error ? ' ' + t('ffmpegPanel.errorSep', { error: info.error }) : ''}
      </span>
      <span className="ffmpeg-path">{info.path}</span>
    </div>
  )
}

interface SettingsPanelProps {
  status: FfmpegStatusReport | null
  loading: boolean
  onRefresh: () => void
}

/** ffmpeg 三源管理面板（T16/T17） */
export function SettingsPanel({
  status,
  loading,
  onRefresh
}: SettingsPanelProps): React.JSX.Element {
  const { t } = useLocale()
  const dl = useFfmpegDownload(onRefresh)
  const [urlOverride, setUrlOverride] = useState<string | null>(null)
  const [customBusy, setCustomBusy] = useState(false)

  // 派生显示：用户编辑优先，否则显示已保存配置（或默认提示）
  const shownUrl = urlOverride ?? status?.config.downloadUrl ?? ''

  const config = status?.config
  const source = config?.source ?? 'system'

  const setSource = async (s: FfmpegSource): Promise<void> => {
    await window.api.ffmpeg.setConfig({ source: s })
    onRefresh()
  }

  const pickCustom = async (): Promise<void> => {
    setCustomBusy(true)
    try {
      const p = await window.api.ffmpeg.pickCustom()
      if (p) {
        await window.api.ffmpeg.setConfig({ customPath: p, source: 'custom' })
        onRefresh()
      }
    } finally {
      setCustomBusy(false)
    }
  }

  const saveUrl = async (): Promise<void> => {
    await window.api.ffmpeg.setConfig({ downloadUrl: shownUrl })
    setUrlOverride(null)
    onRefresh()
  }

  const eff = status?.effective

  return (
    <section className="panel-section">
      <h2>{t('ffmpegPanel.title')}</h2>

      <div className="field">
        <span>{t('ffmpegPanel.currentActive')}</span>
        {eff?.available && eff.info ? (
          <div className="ffmpeg-info">
            <span className="ffmpeg-badge ok">✓</span>
            <span className="ffmpeg-desc">
              {t('ffmpegPanel.versionSep', {
                title: t(SOURCE_LABEL_KEY[eff.source ?? 'system']),
                version: eff.info.version
              })}
            </span>
            <span className="ffmpeg-path">{eff.path}</span>
          </div>
        ) : (
          <p className="field-error">{t('ffmpegPanel.notAvailable')}</p>
        )}
      </div>

      <label className="field">
        <span>{t('ffmpegPanel.useSource')}</span>
        <select value={source} onChange={(e) => void setSource(e.target.value as FfmpegSource)}>
          <option value="system">{t(SOURCE_LABEL_KEY.system)}</option>
          <option value="managed">{t(SOURCE_LABEL_KEY.managed)}</option>
          <option value="custom">{t(SOURCE_LABEL_KEY.custom)}</option>
        </select>
      </label>

      <div className="audio-row">
        <button type="button" className="mini-btn" onClick={() => void onRefresh()}>
          {loading ? t('ffmpegPanel.detecting') : t('ffmpegPanel.redetect')}
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={() => void pickCustom()}
          disabled={customBusy}
        >
          {t('ffmpegPanel.browseExe')}
        </button>
      </div>

      <div className="field">
        <span>{t('ffmpegPanel.threeSources')}</span>
        <InfoRow title={t('ffmpegPanel.rowSystem')} info={status?.system ?? null} />
        <InfoRow title={t('ffmpegPanel.rowManaged')} info={status?.managed ?? null} />
        <InfoRow title={t('ffmpegPanel.rowCustom')} info={status?.custom ?? null} />
      </div>

      <div className="field">
        <span>{t('ffmpegPanel.installTitle')}</span>
        {dl.state && dl.state.phase !== 'done' && (
          <div className="dl-row">
            <div className="dl-bar">
              <div className="dl-fill" style={{ width: (dl.state.percent ?? 0) + '%' }} />
            </div>
            <span className="panel-note">
              {dl.state.message}
              {dl.state.percent != null ? ' ' + dl.state.percent + '%' : ''}
            </span>
            <button type="button" className="mini-btn danger" onClick={dl.cancel}>
              {t('ffmpegPanel.downloadCancel')}
            </button>
          </div>
        )}
        {dl.state?.phase === 'done' && <p className="panel-note">{t('ffmpegPanel.installDone')}</p>}
        {dl.error && <p className="field-error">{dl.error}</p>}
        <div className="audio-row">
          <button
            type="button"
            className="btn"
            onClick={() => void dl.start(shownUrl || undefined)}
          >
            {t('ffmpegPanel.installBtn')}
          </button>
        </div>
        <label className="field">
          <span>{t('ffmpegPanel.urlLabel')}</span>
          <input
            type="text"
            value={shownUrl}
            onChange={(e) => setUrlOverride(e.target.value)}
            placeholder="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
          />
        </label>
        <div className="audio-row">
          <button type="button" className="mini-btn" onClick={() => void saveUrl()}>
            {t('ffmpegPanel.saveUrl')}
          </button>
        </div>
      </div>
    </section>
  )
}
