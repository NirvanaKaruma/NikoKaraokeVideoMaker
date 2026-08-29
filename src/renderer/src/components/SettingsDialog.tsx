import { useState } from 'react'
import type { FfmpegStatusReport } from '@shared/ffmpeg'
import { SUPPORTED_LOCALES, type Locale } from '@shared/i18n'
import { useLocale } from '../hooks/useLocale'
import { SettingsPanel } from './panels/SettingsPanel'
import {
  benchmarkEncoder,
  getEncodeModePref,
  setEncodeModePref,
  type EncodeBenchmark,
  type EncodeModePref
} from '../export/exportVideo'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  status: FfmpegStatusReport | null
  loading: boolean
  onRefresh: () => void
  /** 主题（深色/浅色）：组件只负责展示与回传 */
  theme: 'dark' | 'light'
  onThemeChange: (t: 'dark' | 'light') => void
}

const MODE_LABEL_KEY: Record<EncodeModePref, string> = {
  auto: 'settings.modeAuto',
  hw: 'settings.modeHw',
  sw: 'settings.modeSw'
}

/** 系统级设置弹窗（M5 UI 重构）：ffmpeg 三源 + 语言预留 + 编码加速（GPU 检测与显式模式） */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  const { t, locale, setLocale } = useLocale()
  const { open, onClose, status, loading, onRefresh, theme, onThemeChange } = props
  const [mode, setMode] = useState<EncodeModePref>(() => getEncodeModePref())
  const [diag, setDiag] = useState<EncodeBenchmark | null>(null)
  const [diagRunning, setDiagRunning] = useState(false)

  if (!open) return null

  const runDiag = async (): Promise<void> => {
    setDiagRunning(true)
    try {
      setDiag(await benchmarkEncoder(1920, 1080))
    } finally {
      setDiagRunning(false)
    }
  }

  const applyMode = (m: EncodeModePref): void => {
    setMode(m)
    setEncodeModePref(m)
  }

  const fmtMs = (v: number | null): string =>
    v == null ? t('settings.unavailable') : Math.round(v) + ' ms/帧'

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('settings.title')}</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body">
          <SettingsPanel status={status} loading={loading} onRefresh={onRefresh} />

          <section className="panel-section">
            <h2>{t('settings.theme')}</h2>
            <div className="audio-row">
              <button
                type="button"
                className={'mini-btn' + (theme === 'dark' ? ' mini-btn-active' : '')}
                onClick={() => onThemeChange('dark')}
              >
                {t('settings.themeDark')}
              </button>
              <button
                type="button"
                className={'mini-btn' + (theme === 'light' ? ' mini-btn-active' : '')}
                onClick={() => onThemeChange('light')}
              >
                {t('settings.themeLight')}
              </button>
            </div>
            <p className="panel-note">{t('settings.themeNote')}</p>
          </section>

          <section className="panel-section">
            <h2>{t('settings.language')}</h2>
            <label className="field">
              <span>{t('settings.uiLanguage')}</span>
              <select value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
                {SUPPORTED_LOCALES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nativeName}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="panel-section">
            <h2>{t('settings.encodeAccel')}</h2>
            <label className="field">
              <span>{t('settings.encodeMode')}</span>
              <select value={mode} onChange={(e) => applyMode(e.target.value as EncodeModePref)}>
                <option value="auto">{t(MODE_LABEL_KEY.auto)}</option>
                <option value="hw">{t(MODE_LABEL_KEY.hw)}</option>
                <option value="sw">{t(MODE_LABEL_KEY.sw)}</option>
              </select>
            </label>
            <div className="audio-row">
              <button
                type="button"
                className="mini-btn"
                onClick={() => void runDiag()}
                disabled={diagRunning}
              >
                {diagRunning ? t('settings.detecting') : t('settings.detectGpu')}
              </button>
            </div>
            {diag && (
              <div className="panel-note">
                <p>
                  {t('settings.hw', { v: fmtMs(diag.hardwareMsPerFrame) })} ｜{' '}
                  {t('settings.sw', { v: fmtMs(diag.softwareMsPerFrame) })}
                </p>
                <p>{diag.verdict}</p>
              </div>
            )}
            <p className="panel-note">{t('settings.autoNote')}</p>
          </section>
        </div>
      </div>
    </div>
  )
}
