import type { AudioStatus } from '../../hooks/useAudioPlayback'

function formatTime(t: number): string {
  const m = Math.floor(t / 60)
  const s = Math.floor(t % 60)
  return m + ':' + (s < 10 ? '0' : '') + s
}

interface AudioPanelProps {
  status: AudioStatus
  error: string | null
  duration: number
  currentTime: number
  isPlaying: boolean
  fileName: string | null
  onPlay: () => void
  onPause: () => void
  onSeek: (t: number) => void
}

/** 预览播放面板（T14）：播放/暂停、进度、seek；播完停止不循环 */
export function AudioPanel(props: AudioPanelProps): React.JSX.Element {
  const { status, error, duration, currentTime, isPlaying, fileName, onPlay, onPause, onSeek } =
    props
  return (
    <section className="panel-section">
      <h2>预览播放</h2>
      {status === 'empty' && (
        <p className="panel-note">
          先拖入音频或视频（mp3 / wav / flac / m4a / mp4 / mov / webm）即可预览。
        </p>
      )}
      {status === 'loading' && <p className="panel-note">音频解码中…</p>}
      {status === 'error' && <p className="field-error">{error ?? '音频加载失败'}</p>}
      {status === 'ready' && (
        <>
          {fileName && <p className="audio-file">♪ {fileName}</p>}
          <div className="audio-row">
            <button type="button" className="btn" onClick={isPlaying ? onPause : onPlay}>
              {isPlaying ? '⏸ 暂停' : '▶ 播放'}
            </button>
            <span className="audio-time">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>
          </div>
          <input
            type="range"
            className="audio-seek"
            min={0}
            max={duration || 1}
            step={0.1}
            value={Math.min(currentTime, duration || 1)}
            onChange={(e) => onSeek(Number(e.target.value))}
          />
          <p className="panel-note">播完自动停止；播放中可拖动进度条，波形与频谱同步跳动。</p>
        </>
      )}
    </section>
  )
}
