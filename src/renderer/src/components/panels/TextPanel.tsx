import type { TextLayerConfig } from '@shared/layout'
import { useLocale } from '../../hooks/useLocale'
import { DeferredSlider } from '../DeferredSlider'
import { useSystemFonts } from '../../hooks/useSystemFonts'

/** 内置字体：labelKey 指向语言资源；value 为 CSS font-family */
const BUILTIN_FONTS: { labelKey: string; value: string }[] = [
  {
    labelKey: 'textPanel.fontDefault',
    value: '"Segoe UI", "Microsoft YaHei", "PingFang SC", "Noto Sans CJK SC", sans-serif'
  },
  { labelKey: 'textPanel.fontYahei', value: '"Microsoft YaHei", "Segoe UI", sans-serif' },
  { labelKey: 'textPanel.fontHei', value: '"SimHei", "Microsoft YaHei", sans-serif' },
  { labelKey: 'textPanel.fontSong', value: '"SimSun", "Songti SC", serif' },
  { labelKey: 'textPanel.fontKai', value: '"KaiTi", "Kaiti SC", serif' },
  { labelKey: 'textPanel.fontFangSong', value: '"FangSong", "STFangsong", serif' },
  { labelKey: 'textPanel.fontDengXian', value: '"DengXian", "Microsoft YaHei", sans-serif' },
  { labelKey: 'textPanel.fontYouYuan', value: '"YouYuan", "Microsoft YaHei", sans-serif' }
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
  const { t } = useLocale()
  const s = cfg.style
  const setStyle = (patch: Partial<TextLayerConfig['style']>): void =>
    onChange({ style: { ...s, ...patch } })
  return (
    <div className="text-block">
      <h3>{title}</h3>
      <label className="field">
        <span>{t('textPanel.font')}</span>
        <select value={s.fontFamily} onChange={(e) => setStyle({ fontFamily: e.target.value })}>
          <optgroup label={t('textPanel.commonFonts')}>
            {BUILTIN_FONTS.map((f) => (
              <option key={f.labelKey} value={f.value}>
                {t(f.labelKey)}
              </option>
            ))}
          </optgroup>
          {systemFonts.length > 0 && (
            <optgroup label={t('textPanel.systemFonts')}>
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
        label={(v) => t('textPanel.size', { v: Math.round(v * 100) })}
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
        <span>{t('textPanel.bold')}</span>
      </label>
      <label className="field">
        <span>{t('textPanel.textColor')}</span>
        <input type="color" value={s.color} onChange={(e) => setStyle({ color: e.target.value })} />
      </label>
      <label className="field">
        <span>{t('textPanel.strokeColor')}</span>
        <input
          type="color"
          value={s.strokeColor}
          onChange={(e) => setStyle({ strokeColor: e.target.value })}
        />
      </label>
      <DeferredSlider
        label={(v) => t('textPanel.strokeWidth', { v: (v * 100).toFixed(2) })}
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
        <span>{t('textPanel.glow')}</span>
      </label>
      <label className="field">
        <span>{t('textPanel.glowColor')}</span>
        <input
          type="color"
          value={s.glowColor}
          onChange={(e) => setStyle({ glowColor: e.target.value })}
        />
      </label>
      <DeferredSlider
        label={(v) => t('textPanel.glowStrength', { v: Math.round(v * 2000) })}
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
  const { t } = useLocale()
  const sys = useSystemFonts()
  return (
    <section className="panel-section">
      <h2>{t('textPanel.title')}</h2>
      <div className="gradient-row">
        <button type="button" className="mini-btn" onClick={() => void sys.scan()}>
          {sys.loading ? t('textPanel.scanning') : t('textPanel.rescan')}
        </button>
        <span className="panel-note">
          {sys.scanned && !sys.error
            ? t('textPanel.loaded', { n: sys.fonts.length })
            : sys.error
              ? t('textPanel.loadFailed')
              : t('textPanel.firstScan')}
        </span>
      </div>
      <StyleControls
        title={t('textPanel.songTitle')}
        cfg={props.songTitle}
        systemFonts={sys.fonts}
        onChange={props.onSongTitleChange}
      />
      <StyleControls
        title={t('textPanel.artist')}
        cfg={props.artist}
        systemFonts={sys.fonts}
        onChange={props.onArtistChange}
      />
    </section>
  )
}
