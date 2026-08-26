import type { ExportConfig } from '@shared/layout'
import { RESOLUTIONS } from '@shared/layout'

interface ExportPanelProps {
  config: ExportConfig
  onChange: (patch: Partial<ExportConfig>) => void
}

/** 导出设置面板：分辨率 / 帧率（导出管线 M4 启用，配置即项目数据） */
export function ExportPanel({ config, onChange }: ExportPanelProps): React.JSX.Element {
  return (
    <section className="panel-section">
      <h2>导出设置</h2>
      <label className="field">
        <span>分辨率</span>
        <select
          value={config.resolutionId}
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
        <select value={config.fps} onChange={(e) => onChange({ fps: Number(e.target.value) })}>
          <option value={30}>30 fps（推荐）</option>
          <option value={60}>60 fps（更丝滑，编码耗时约翻倍）</option>
        </select>
      </label>
      <p className="panel-note">
        导出按钮将在 M4 启用；这些选项已写入项目布局数据，预览与导出共用。
      </p>
    </section>
  )
}
