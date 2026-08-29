import { useRef, useState } from 'react'
import { useLocale } from '../../hooks/useLocale'

interface InputPanelProps {
  songTitle: string
  artist: string
  coverUrl: string | null
  coverFile: File | null
  audioFile: File | null
  fileError: string | null
  onSongTitleChange: (v: string) => void
  onArtistChange: (v: string) => void
  onCoverFile: (f: File | null) => void
  onAudioFile: (f: File | null) => void
  /** 一键主题色（0.8.0）：仅当封面就绪时可用 */
  themeBusy?: boolean
  onApplyTheme?: () => void
}

interface DropZoneProps {
  label: string
  hint: string
  file: File | null
  previewUrl: string | null
  accept: string
  onFile: (f: File | null) => void
}

function DropZone({
  label,
  hint,
  file,
  previewUrl,
  accept,
  onFile
}: DropZoneProps): React.JSX.Element {
  const [over, setOver] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <div
      className={'drop-zone' + (over ? ' over' : '')}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        onFile(e.dataTransfer.files?.[0] ?? null)
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0] ?? null)
          e.target.value = ''
        }}
      />
      {previewUrl ? (
        <img src={previewUrl} alt="封面预览" className="drop-preview" />
      ) : (
        <span className="drop-hint">{hint}</span>
      )}
      <span className="drop-file">{file ? file.name : label}</span>
    </div>
  )
}

export function InputPanel(props: InputPanelProps): React.JSX.Element {
  const { t } = useLocale()
  return (
    <section className="panel-section">
      <h2>{t('input.title')}</h2>
      <label className="field">
        <span>{t('input.songTitle')}</span>
        <input
          type="text"
          value={props.songTitle}
          onChange={(e) => props.onSongTitleChange(e.target.value)}
        />
      </label>
      <label className="field">
        <span>{t('input.artist')}</span>
        <input
          type="text"
          value={props.artist}
          onChange={(e) => props.onArtistChange(e.target.value)}
        />
      </label>
      <div className="field">
        <span>{t('input.cover')}</span>
        <DropZone
          label={t('input.coverDrop')}
          hint={t('input.coverHint')}
          file={props.coverFile}
          previewUrl={props.coverUrl}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          onFile={props.onCoverFile}
        />
      </div>
      {props.onApplyTheme && (
        <div className="field">
          <button
            type="button"
            className="btn"
            disabled={props.themeBusy}
            onClick={props.onApplyTheme}
          >
            {t('input.applyTheme')}
          </button>
          <p className="panel-note">{t('input.themeNote')}</p>
        </div>
      )}
      <div className="field">
        <span>{t('input.audio')}</span>
        <DropZone
          label={t('input.audioDrop')}
          hint={t('input.audioHint')}
          file={props.audioFile}
          previewUrl={null}
          accept=".mp3,.wav,.flac,.m4a,.ogg,.mp4,.m4v,.mov,.webm,audio/*,video/*"
          onFile={props.onAudioFile}
        />
      </div>
      {props.fileError && <p className="field-error">{props.fileError}</p>}
    </section>
  )
}
