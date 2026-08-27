import type { TextLayerConfig } from '@shared/layout'
import { DeferredSlider } from '../DeferredSlider'
import { useSystemFonts } from '../../hooks/useSystemFonts'

const BUILTIN_FONTS: { label: string; value: string }[] = [
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

const systemFontValue = (family: string): string => '"' + family.replace(/"/g, '') + '", sans-serif'

interface StyleControlsProps {
  title: string
  cfg: TextLayerConfig
  systemFonts: string[]
  onChange: (patch: Partial<TextLayerConfig>) => void
}

function StyleControls({
  title,
  cfg,
  systemFonts,
  onChange
}: StyleControlsProps): React.JSX.Element {
  const s = cfg.style
  const setStyle = (patch: Partial<TextLayerConfig['style']>): void =>
    onChange({ style: { ...s, ...patch } })
  return (
    <div className="text-block">
      <h3>{title}</h3>
      <label className="field">
        <span>字体</span>
        <select value={s.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
          <optgroup label="常用字体">
            {BUILTIN_FONTS.map((f) => (
              <option key={f.label} value={f.value}>
                {f.label}
              </option>
            ))}
          </optgroup>
          {systemFonts.length > 0 && (
            <optgroup label="系统字体">
              {systemFonts.map((f) => (
                <option key={f} value={systemFontValue(f)}>
                  {f}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </label>
      <DeferredSlider
        label={(v) => '字号：' + Math.round(v * 100) + '%'}
        value={s.fontSize}
        min={0.02}
        max={0.2}
        step={0.005}
        onCommit={(v) => setStyle({ fontSize: v })}
      />
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
      <DeferredSlider
        label={(v) => '描边宽度：' + (v * 100).toFixed(2) + '%'}
        value={s.strokeWidth}
        min={0}
        max={0.02}
        step={0.0005}
        onCommit={(v) => setStyle({ strokeWidth: v })}
      />
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
      <DeferredSlider
        label={(v) => '发光强度：' + Math.round(v * 2000)}
        value={s.glowBlur}
        min={0}
        max={0.05}
        step={0.0005}
        onCommit={(v) => setStyle({ glowBlur: v })}
      />
    </div>
  )
}

interface TextPanelProps {
  songTitle: TextLayerConfig
  artist: TextLayerConfig
  onSongTitleChange: (patch: Partial<TextLayerConfig>) => void
  onArtistChange: (patch: Partial<TextLayerConfig>) => void
}

/** 文本样式面板：歌曲名 / 作者分别独立可调（T11）；支持扫描系统全部字体 */
export function TextPanel(props: TextPanelProps): React.JSX.Element {
  const sys = useSystemFonts()
  return (
    <section className="panel-section">
      <h2>文本样式</h2>
      <div className="gradient-row">
        <button type="button" className="mini-btn" onClick={() => void sys.scan()}>
          {sys.loading ? '扫描中…' : '重新载入系统字体'}
        </button>
        <span className="panel-note">
          {sys.scanned && !sys.error
            ? '已载入 ' + sys.fonts.length + ' 个系统字体'
            : sys.error
              ? '无法读取系统字体列表（仅显示常用字体）'
              : '首次自动扫描中…'}
        </span>
      </div>
      <StyleControls
        title="歌曲名"
        cfg={props.songTitle}
        systemFonts={sys.fonts}
        onChange={props.onSongTitleChange}
      />
      <StyleControls
        title="作者"
        cfg={props.artist}
        systemFonts={sys.fonts}
        onChange={props.onArtistChange}
      />
    </section>
  )
}
