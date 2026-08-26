import type { ExportConfig } from '@shared/layout'
import { RESOLUTIONS } from '@shared/layout'
import type { ExporterState } from '../../hooks/useExporter'

interface ExportPanelProps {
  config: ExportConfig
  onChange: (patch: Partial<ExportConfig>) => void
  state: ExporterState
  ffmpegAvailable: boolean
  audioReady: boolean
  onExport: () => void
  onCancel: () => void
  onClose: () => void
}

/** 导出设置 + 执行面板（T18–T20） */
export function ExportPanel(props: ExportPanelProps): React.JSX.Element {
  const { config, onChange, state, ffmpegAvailable, audioReady, onExport, onCancel, onClose } =
    props
  const busy =
    state.phase === 'preparing' || state.phase === 'encoding' || state.phase === 'merging'
  const percent =
    state.phase === 'encoding' && state.total > 0
      ? Math.round((state.encoded / state.total) * 100)
      : state.phase === 'merging'
        ? (state.mergePercent ?? null)
        : null

  return (
    <section className="panel-section">
      <h2>导出</h2>
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
          <option value={30}>30 fps（推荐）</option>
          <option value={60}>60 fps（更丝滑，编码耗时约翻倍）</option>
        </select>
      </label>

      {!ffmpegAvailable && (
        <p className="field-error">
          未检测到 ffmpeg：导出已禁用，请到下方「ffmpeg 设置」安装或指定。
        </p>
      )}
      {ffmpegAvailable && !audioReady && (
        <p className="panel-note">先拖入音频并等待解码完成，才能导出。</p>
      )}

      {!busy && state.phase !== 'done' && (
        <button
          type="button"
          className="btn"
          disabled={!ffmpegAvailable || !audioReady}
          onClick={onExport}
        >
          导出视频
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
          <button type="button" className="mini-btn" onClick={onClose}>
            完成
          </button>
        </div>
      )}

      {(state.phase === 'error' || state.phase === 'cancelled') && (
        <div className="export-done">
          <p className="field-error">{state.error ?? state.message}</p>
          <button type="button" className="mini-btn" onClick={onClose}>
            关闭
          </button>
        </div>
      )}
    </section>
  )
}
