import { useState } from 'react'
import type { FfmpegDetectInfo, FfmpegSource, FfmpegStatusReport } from '@shared/ffmpeg'
import { useFfmpegDownload } from '../../hooks/useFfmpeg'

const SOURCE_LABEL: Record<FfmpegSource, string> = {
  system: '系统 PATH（自动检测）',
  managed: '应用托管版',
  custom: '手动指定'
}

function InfoRow({
  title,
  info
}: {
  title: string
  info: FfmpegDetectInfo | null
}): React.JSX.Element {
  if (!info) {
    return <p className="panel-note">{title}：未检测到</p>
  }
  return (
    <div className="ffmpeg-info">
      <span className={'ffmpeg-badge ' + (info.status === 'ok' ? 'ok' : 'bad')}>
        {info.status === 'ok' ? '✓' : '✗'}
      </span>
      <span className="ffmpeg-desc">
        {title}：{info.version} ｜ aac {info.hasAac ? '✓' : '✗'}
        {info.status === 'ok' && !info.hasLibx264 ? '（无 libx264，仅警告）' : ''}
        {info.error ? ' ｜ ' + info.error : ''}
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
      <h2>ffmpeg 设置</h2>

      <div className="field">
        <span>当前生效</span>
        {eff?.available && eff.info ? (
          <div className="ffmpeg-info">
            <span className="ffmpeg-badge ok">✓</span>
            <span className="ffmpeg-desc">
              {SOURCE_LABEL[eff.source ?? 'system']}：{eff.info.version} ｜ aac{' '}
              {eff.info.hasAac ? '✓' : '✗'}
              {!eff.info.hasLibx264 ? '（无 libx264，仅警告）' : ''}
            </span>
            <span className="ffmpeg-path">{eff.path}</span>
          </div>
        ) : (
          <p className="field-error">未检测到可用 ffmpeg（导出已禁用）</p>
        )}
      </div>

      <label className="field">
        <span>使用来源（切换立即生效并保存）</span>
        <select value={source} onChange={(e) => void setSource(e.target.value as FfmpegSource)}>
          <option value="system">{SOURCE_LABEL.system}</option>
          <option value="managed">{SOURCE_LABEL.managed}</option>
          <option value="custom">{SOURCE_LABEL.custom}</option>
        </select>
      </label>

      <div className="audio-row">
        <button type="button" className="mini-btn" onClick={() => void onRefresh()}>
          {loading ? '检测中…' : '重新检测'}
        </button>
        <button
          type="button"
          className="mini-btn"
          onClick={() => void pickCustom()}
          disabled={customBusy}
        >
          浏览指定 ffmpeg.exe
        </button>
      </div>

      <div className="field">
        <span>三源状态</span>
        <InfoRow title="系统 PATH" info={status?.system ?? null} />
        <InfoRow title="托管版" info={status?.managed ?? null} />
        <InfoRow title="手动指定" info={status?.custom ?? null} />
      </div>

      <div className="field">
        <span>托管版一键安装（gyan.dev 稳定版，仅解压 ffmpeg.exe）</span>
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
              取消
            </button>
          </div>
        )}
        {dl.state?.phase === 'done' && <p className="panel-note">✓ 安装完成，已自动重新检测。</p>}
        {dl.error && <p className="field-error">{dl.error}</p>}
        <div className="audio-row">
          <button
            type="button"
            className="btn"
            onClick={() => void dl.start(shownUrl || undefined)}
          >
            一键下载安装
          </button>
        </div>
        <label className="field">
          <span>下载地址覆盖（留空 = 默认 gyan.dev；可填镜像）</span>
          <input
            type="text"
            value={shownUrl}
            onChange={(e) => setUrlOverride(e.target.value)}
            placeholder="https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip"
          />
        </label>
        <div className="audio-row">
          <button type="button" className="mini-btn" onClick={() => void saveUrl()}>
            保存地址
          </button>
        </div>
      </div>
    </section>
  )
}
