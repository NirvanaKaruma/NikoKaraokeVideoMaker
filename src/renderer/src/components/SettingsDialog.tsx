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

  const effInfo = status?.effective?.info ?? null

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
            <h2>语言（Language）</h2>
            <label className="field">
              <span>界面语言</span>
              <select value="zh-CN" disabled>
                <option value="zh-CN">简体中文（当前）</option>
                <option value="en-US">English（预留，待实现 i18n）</option>
              </select>
            </label>
            <p className="panel-note">已预留多语言接口，后续版本可扩展。</p>
          </section>

          <section className="panel-section">
            <h2>编码加速</h2>
            <label className="field">
              <span>编码模式（显式选择）</span>
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
            <p className="panel-note">
              WebCodecs 编码路径：本机 Chromium 是否暴露 GPU
              编码器因机器而异；「自动」模式按上述实测选择更快路径。
            </p>
          </section>

          <section className="panel-section">
            <h2>ffmpeg 硬件能力（信息展示）</h2>
            {effInfo ? (
              <div className="panel-note">
                <p>
                  NVIDIA NVENC：{effInfo.hasNvenc ? '✓ 有' : '✗ 无'} ｜ Intel QSV：
                  {effInfo.hasQsv ? '✓ 有' : '✗ 无'} ｜ AMD AMF：{effInfo.hasAmf ? '✓ 有' : '✗ 无'}
                </p>
                <p>
                  硬件加速器：{effInfo.hwaccels.length > 0 ? effInfo.hwaccels.join('、') : '无'}
                </p>
                <p>
                  说明：当前导出管线的视频编码在 WebCodecs（本页「编码加速」控制）；ffmpeg
                  仅做无损混流（copy）与 AAC 音频编码。若未来启用 raw 帧回退管线，将优先使用上述
                  ffmpeg 硬件编码器（如 nvenc）。
                </p>
              </div>
            ) : (
              <p className="panel-note">未检测到可用 ffmpeg，暂无硬件能力信息。</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
