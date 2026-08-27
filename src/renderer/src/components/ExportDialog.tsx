import { useState } from 'react'
import type { ExportConfig } from '@shared/layout'
import { RESOLUTIONS } from '@shared/layout'
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

const MODE_LABEL: Record<EncodeModePref, string> = {
  auto: '自动（按本机检测结果）',
  hw: '强制 GPU 硬件编码',
  sw: '强制 CPU 软件编码'
}

/** 导出弹窗（M5 UI 重构：右上角入口，弹窗内选参数并执行） */
export function ExportDialog(props: ExportDialogProps): React.JSX.Element | null {
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
          <h2>导出视频</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="modal-body">
          <label className="field">
            <span>分辨率</span>
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
            <span>帧率</span>
            <select
              value={config.fps}
              disabled={busy}
              onChange={(e) => onChange({ fps: Number(e.target.value) })}
            >
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>
          <label className="field">
            <span>编码加速</span>
            <select
              value={mode}
              disabled={busy}
              onChange={(e) => applyMode(e.target.value as EncodeModePref)}
            >
              <option value="auto">{MODE_LABEL.auto}</option>
              <option value="hw">{MODE_LABEL.hw}</option>
              <option value="sw">{MODE_LABEL.sw}</option>
            </select>
          </label>
          <p className="panel-note">详细检测见「设置 → 编码加速」。</p>

          {!ffmpegAvailable && (
            <p className="field-error">
              未检测到 ffmpeg：导出已禁用，请到「设置 → ffmpeg」安装或指定。
            </p>
          )}
          {ffmpegAvailable && !audioReady && (
            <p className="panel-note">请先拖入音频，就绪后才能导出。</p>
          )}

          {!busy && state.phase !== 'done' && (
            <button
              type="button"
              className="btn"
              disabled={!ffmpegAvailable || !audioReady}
              onClick={onExport}
            >
              开始导出
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
                取消导出
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
