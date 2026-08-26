import { useRef, useState } from 'react'

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
  return (
    <section className="panel-section">
      <h2>输入</h2>
      <label className="field">
        <span>歌曲名</span>
        <input
          type="text"
          value={props.songTitle}
          onChange={(e) => props.onSongTitleChange(e.target.value)}
        />
      </label>
      <label className="field">
        <span>作者</span>
        <input
          type="text"
          value={props.artist}
          onChange={(e) => props.onArtistChange(e.target.value)}
        />
      </label>
      <div className="field">
        <span>封面图（png / jpg / webp，支持透明）</span>
        <DropZone
          label="点击或拖入封面图"
          hint="＋ 封面图"
          file={props.coverFile}
          previewUrl={props.coverUrl}
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          onFile={props.onCoverFile}
        />
      </div>
      <div className="field">
        <span>音频（mp3 / wav / flac / m4a）</span>
        <DropZone
          label="点击或拖入音频"
          hint="♪ 音频"
          file={props.audioFile}
          previewUrl={null}
          accept=".mp3,.wav,.flac,.m4a,audio/*"
          onFile={props.onAudioFile}
        />
      </div>
      {props.fileError && <p className="field-error">{props.fileError}</p>}
    </section>
  )
}
