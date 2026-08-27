import { useLocale } from '../../hooks/useLocale'
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
  const { t } = useLocale()
  const { status, error, duration, currentTime, isPlaying, fileName, onPlay, onPause, onSeek } =
    props
  return (
    <section className="panel-section">
      <h2>{t('audio.title')}</h2>
      {status === 'empty' && <p className="panel-note">{t('audio.emptyHint')}</p>}
      {status === 'loading' && <p className="panel-note">{t('audio.decoding')}</p>}
      {status === 'error' && <p className="field-error">{error ?? t('audio.loadFailed')}</p>}
      {status === 'ready' && (
        <>
          {fileName && <p className="audio-file">♪ {fileName}</p>}
          <div className="audio-row">
            <button type="button" className="btn" onClick={isPlaying ? onPause : onPlay}>
              {isPlaying ? t('audio.pause') : t('audio.play')}
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
        </>
      )}
    </section>
  )
}
