import { useState } from 'react'
import type { FfmpegStatusReport } from '@shared/ffmpeg'
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
}

const MODE_LABEL: Record<EncodeModePref, string> = {
  auto: '自动（按本机检测结果）',
  hw: '强制 GPU 硬件编码',
  sw: '强制 CPU 软件编码'
}

/** 系统级设置弹窗（M5 UI 重构）：ffmpeg 三源 + 语言预留 + 编码加速（GPU 检测与显式模式） */
export function SettingsDialog(props: SettingsDialogProps): React.JSX.Element | null {
  const { open, onClose, status, loading, onRefresh } = props
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

  const fmtMs = (v: number | null): string => (v == null ? '不可用' : Math.round(v) + ' ms/帧')

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>设置</h2>
          <button type="button" className="mini-btn" onClick={onClose}>
            ✕ 关闭
          </button>
        </div>
        <div className="modal-body">
          <SettingsPanel status={status} loading={loading} onRefresh={onRefresh} />

          <section className="panel-section">
            <h2>编码加速</h2>
            <label className="field">
              <span>编码模式</span>
              <select value={mode} onChange={(e) => applyMode(e.target.value as EncodeModePref)}>
                <option value="auto">{MODE_LABEL.auto}</option>
                <option value="hw">{MODE_LABEL.hw}</option>
                <option value="sw">{MODE_LABEL.sw}</option>
              </select>
            </label>
            <div className="audio-row">
              <button
                type="button"
                className="mini-btn"
                onClick={() => void runDiag()}
                disabled={diagRunning}
              >
                {diagRunning ? '检测中…' : '重新检测本机 GPU 加速'}
              </button>
            </div>
            {diag && (
              <div className="panel-note">
                <p>
                  硬件编码：{fmtMs(diag.hardwareMsPerFrame)} ｜ 软件编码：
                  {fmtMs(diag.softwareMsPerFrame)}
                </p>
                <p>{diag.verdict}</p>
              </div>
            )}
            <p className="panel-note">「自动」模式会按本机实测结果选择更快的编码方式。</p>
          </section>
        </div>
      </div>
    </div>
  )
}
