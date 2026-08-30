import { useState } from 'react'
import type { ExportConfig } from '@shared/layout'
import { useLocale } from '../hooks/useLocale'
import { EXPORT_BITRATE_KBPS, RESOLUTIONS, videoBitrateKbpsFor } from '@shared/layout'
import type { ExporterState } from '../hooks/useExporter'
import { getEncodeModePref, setEncodeModePref, type EncodeModePref } from '../export/exportVideo'

interface ExportDialogProps {
  open: boolean
  onClose: () => void
  config: ExportConfig
  onChange: (patch: Partial<ExportConfig>) => void
  state: ExporterState
  ffmpegAvailable: boolean
  audioReady: boolean
  onExport: () => void
  onCancel: () => void
}

const MODE_LABEL_KEY: Record<EncodeModePref, string> = {
  auto: 'exportDialog.modeAuto',
  hw: 'exportDialog.modeHw',
  sw: 'exportDialog.modeSw'
}

/** 导出弹窗（M5 UI 重构：右上角入口，弹窗内选参数并执行） */
export function ExportDialog(props: ExportDialogProps): React.JSX.Element | null {
  const { t } = useLocale()
  const {
    open,
    onClose,
    config,
    onChange,
    state,
    ffmpegAvailable,
    audioReady,
    onExport,
    onCancel
  } = props
  const [mode, setMode] = useState<EncodeModePref>(() => getEncodeModePref())

  if (!open) return null

  const busy =
    state.phase === 'preparing' || state.phase === 'encoding' || state.phase === 'merging'
  const percent =
    state.phase === 'encoding' && state.total > 0
      ? Math.round((state.encoded / state.total) * 100)
      : state.phase === 'merging'
        ? (state.mergePercent ?? null)
        : null

  const applyMode = (m: EncodeModePref): void => {
    setMode(m)
    setEncodeModePref(m)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal modal-narrow" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{t('exportDialog.title')}</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>{t('exportDialog.resolution')}</span>
            <select
              value={config.resolutionId}
              disabled={busy}
              onChange={(e) => onChange({ resolutionId: e.target.value })}
            >
              {RESOLUTIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}（{r.id}）
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>{t('exportDialog.fps')}</span>
            <select
              value={config.fps}
              disabled={busy}
              onChange={(e) => onChange({ fps: Number(e.target.value) })}
            >
              <option value={30}>{t('exportDialog.fps30')}</option>
              <option value={60}>{t('exportDialog.fps60')}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('exportDialog.encodeAccel')}</span>
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => applyMode(e.target.value as EncodeModePref)}
            >
              <option value="auto">{t(MODE_LABEL_KEY.auto)}</option>
              <option value="hw">{t(MODE_LABEL_KEY.hw)}</option>
              <option value="sw">{t(MODE_LABEL_KEY.sw)}</option>
            </select>
          </label>
          <label className="field">
            <span>{t('exportDialog.bitrate')}</span>
            <select
              value={config.videoBitrateKbps == null ? 'auto' : 'custom'}
              disabled={busy}
              onChange={(e) =>
                onChange({
                  videoBitrateKbps:
                    e.target.value === 'auto'
                      ? null
                      : (config.videoBitrateKbps ??
                        EXPORT_BITRATE_KBPS[config.resolutionId] ??
                        10000)
                })
              }
            >
              <option value="auto">{t('exportDialog.bitrateAuto')}</option>
              <option value="custom">{t('exportDialog.bitrateCustom')}</option>
            </select>
          </label>
          {config.videoBitrateKbps != null && (
            <label className="field">
              <span>{t('exportDialog.bitrateValue')}</span>
              <input
                type="number"
                min={500}
                max={100000}
                step={500}
                value={config.videoBitrateKbps}
                disabled={busy}
                onChange={(e) => {
                  const v = Number(e.target.value)
                  if (Number.isFinite(v)) onChange({ videoBitrateKbps: v })
                }}
              />
            </label>
          )}
          <p className="panel-note">
            {t('exportDialog.bitrateHint', {
              mbps: (videoBitrateKbpsFor(config, config.resolutionId) / 1000).toFixed(1)
            })}
          </p>
          <p className="panel-note">{t('exportDialog.detailNote')}</p>

          {!ffmpegAvailable && <p className="field-error">{t('exportDialog.noFfmpeg')}</p>}
          {ffmpegAvailable && !audioReady && (
            <p className="panel-note">{t('exportDialog.needAudio')}</p>
          )}

          {!busy && state.phase !== 'done' && (
            <button
              type="button"
              className="btn"
              disabled={!ffmpegAvailable || !audioReady}
              onClick={onExport}
            >
              {t('exportDialog.start')}
            </button>
          )}

          {busy && (
            <div className="export-progress">
              <div className="dl-bar">
                <div className="dl-fill" style={{ width: (percent ?? 5) + '%' }} />
              </div>
              <p className="panel-note">
                {state.message}
                {percent != null ? ' ' + percent + '%' : ''}
              </p>
              <button type="button" className="mini-btn danger" onClick={onCancel}>
                {t('exportDialog.cancel')}
              </button>
            </div>
          )}

          {state.phase === 'done' && (
            <div className="export-done">
              <p className="panel-note">✓ {state.message}</p>
            </div>
          )}

          {(state.phase === 'error' || state.phase === 'cancelled') && (
            <div className="export-done">
              <p className="field-error">{state.error ?? state.message}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
