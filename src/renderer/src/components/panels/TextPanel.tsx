import type { TextLayerConfig } from '@shared/layout'

const FONT_OPTIONS: { label: string; value: string }[] = [
  {
    label: '系统默认',
    value: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
  },
  { label: '微软雅黑', value: '"Microsoft YaHei", "Segoe UI", sans-serif' },
  { label: '黑体', value: '"SimHei", "Microsoft YaHei", sans-serif' },
  { label: '宋体', value: '"SimSun", "Songti SC", serif' },
  { label: '楷体', value: '"KaiTi", "Kaiti SC", serif' },
  { label: '仿宋', value: '"FangSong", "STFangsong", serif' },
  { label: '等线', value: '"DengXian", "Microsoft YaHei", sans-serif' },
  { label: '幼圆', value: '"YouYuan", "Microsoft YaHei", sans-serif' }
]

interface StyleControlsProps {
  title: string
  cfg: TextLayerConfig
  onChange: (patch: Partial<TextLayerConfig>) => void
}

function StyleControls({ title, cfg, onChange }: StyleControlsProps): React.JSX.Element {
  const s = cfg.style
  const setStyle = (patch: Partial<TextLayerConfig['style']>): void =>
    onChange({ style: { ...s, ...patch } })
  return (
    <div className="text-block">
      <h3>{title}</h3>
      <label className="field">
        <span>字体</span>
        <select value={s.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
          {FONT_OPTIONS.map((f) => (
            <option key={f.label} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>字号：{Math.round(s.fontSize * 100)}%（相对画布高）</span>
        <input
          type="range"
          min={2}
          max={20}
          value={Math.round(s.fontSize * 100)}
          onChange={(e) => setStyle({ fontSize: Number(e.target.value) / 100 })}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={s.bold}
          onChange={(e) => setStyle({ bold: e.target.checked })}
        />
        <span>加粗</span>
      </label>
      <label className="field">
        <span>文字颜色</span>
        <input type="color" value={s.color} onChange={(e) => setStyle({ color: e.target.value })} />
      </label>
      <label className="field">
        <span>描边颜色</span>
        <input
          type="color"
          value={s.strokeColor}
          onChange={(e) => setStyle({ strokeColor: e.target.value })}
        />
      </label>
      <label className="field">
        <span>描边宽度：{(s.strokeWidth * 100).toFixed(2)}%（0 = 无描边）</span>
        <input
          type="range"
          min={0}
          max={40}
          value={Math.round(s.strokeWidth * 2000)}
          onChange={(e) => setStyle({ strokeWidth: Number(e.target.value) / 2000 })}
        />
      </label>
      <label className="check-row">
        <input
          type="checkbox"
          checked={s.glowEnabled}
          onChange={(e) => setStyle({ glowEnabled: e.target.checked })}
        />
        <span>外发光</span>
      </label>
      <label className="field">
        <span>发光颜色</span>
        <input
          type="color"
          value={s.glowColor}
          onChange={(e) => setStyle({ glowColor: e.target.value })}
        />
      </label>
      <label className="field">
        <span>发光强度：{Math.round(s.glowBlur * 2000)}</span>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(s.glowBlur * 2000)}
          onChange={(e) => setStyle({ glowBlur: Number(e.target.value) / 2000 })}
        />
      </label>
    </div>
  )
}

interface TextPanelProps {
  songTitle: TextLayerConfig
  artist: TextLayerConfig
  onSongTitleChange: (patch: Partial<TextLayerConfig>) => void
  onArtistChange: (patch: Partial<TextLayerConfig>) => void
}

/** 文本样式面板：歌曲名 / 作者分别独立可调（T11） */
export function TextPanel(props: TextPanelProps): React.JSX.Element {
  return (
    <section className="panel-section">
      <h2>文本样式</h2>
      <StyleControls title="歌曲名" cfg={props.songTitle} onChange={props.onSongTitleChange} />
      <StyleControls title="作者" cfg={props.artist} onChange={props.onArtistChange} />
    </section>
  )
}
