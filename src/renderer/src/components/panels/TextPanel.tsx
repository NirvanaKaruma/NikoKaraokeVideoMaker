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
  /** 关键帧路径前缀：songTitle/artist → texts.<kind>.*；'text:<id>' → texts.extraTexts.<id>.* */
  kind: string
  systemFonts: string[]
  /** P3b 菱形打帧入口 */
  kfOps?: {
    hasKeyframe: (path: string) => boolean
    addKeyframeAt: (path: string) => void
  }
  /** 自定义字体（0.8.0）：注册成功后的家庭名 + 文件名 */
  customFontFamily?: string | null
  customFontName?: string | null
  onChange: (patch: Partial<TextLayerConfig>) => void
}

function StyleControls({
  title,
  cfg,
  kind,
  systemFonts,
  customFontFamily,
  customFontName,
  onChange,
  kfOps
}: StyleControlsProps): React.JSX.Element {
  const kfp = (p: string): string =>
    kind.startsWith('text:')
      ? 'texts.extraTexts.' + kind.slice('text:'.length) + '.' + p
      : 'texts.' + kind + '.' + p
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
          {customFontFamily && (
            <optgroup label={t('textPanel.customFontGroup')}>
              <option value={customFontFamily}>{customFontName ?? customFontFamily}</option>
            </optgroup>
          )}
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
        unitScale={100}
        value={s.fontSize}
        min={0.02}
        max={0.2}
        step={0.005}
        kfPath={kfp('style.fontSize')}
        kfHas={kfOps?.hasKeyframe(kfp('style.fontSize'))}
        onKfAdd={kfOps?.addKeyframeAt}
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
        unitScale={100}
        value={s.strokeWidth}
        min={0}
        max={0.02}
        step={0.0005}
        kfPath={kfp('style.strokeWidth')}
        kfHas={kfOps?.hasKeyframe(kfp('style.strokeWidth'))}
        onKfAdd={kfOps?.addKeyframeAt}
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
        kfPath={kfp('style.glowBlur')}
        kfHas={kfOps?.hasKeyframe(kfp('style.glowBlur'))}
        onKfAdd={kfOps?.addKeyframeAt}
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
  /** 1.1.1 自定义文本框（id → 配置；选中一个编辑其全部属性） */
  extraTexts: Record<string, TextLayerConfig>
  selectedExtraTextId: string | null
  onSelectExtraText: (id: string | null) => void
  onExtraTextChange: (id: string, patch: Partial<TextLayerConfig>) => void
  /** 1.1.1 增删自定义文本框 */
  onExtraTextAdd: () => string
  onExtraTextRemove: (id: string) => void
  /** 自定义字体（0.8.0） */
  customFontFamily?: string | null
  customFontName?: string | null
  onPickFont?: (file: File | null) => void
  /** P3b 菱形打帧入口 */
  kfOps?: {
    hasKeyframe: (path: string) => boolean
    addKeyframeAt: (path: string) => void
  }
}

/** 文本样式面板：歌曲名 / 作者分别独立可调（T11）；支持扫描系统全部字体 + 自定义 ttf/otf */
export function TextPanel(props: TextPanelProps): React.JSX.Element {
  const { t } = useLocale()
  const sys = useSystemFonts()
  return (
    <section className="panel-section">
      <h2>{t('textPanel.title')}</h2>
      <label className="field">
        <span>{t('textPanel.customFontGroup')}</span>
        <input
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          onChange={(e) => {
            props.onPickFont?.(e.target.files?.[0] ?? null)
            e.target.value = ''
          }}
        />
        <span className="panel-note">
          {props.customFontName
            ? t('textPanel.customFontLoaded', { name: props.customFontName })
            : t('textPanel.customFontHint')}
        </span>
      </label>
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
        kind="songTitle"
        cfg={props.songTitle}
        systemFonts={sys.fonts}
        customFontFamily={props.customFontFamily}
        customFontName={props.customFontName}
        kfOps={props.kfOps}
        onChange={props.onSongTitleChange}
      />
      <StyleControls
        title={t('textPanel.artist')}
        kind="artist"
        cfg={props.artist}
        systemFonts={sys.fonts}
        customFontFamily={props.customFontFamily}
        customFontName={props.customFontName}
        kfOps={props.kfOps}
        onChange={props.onArtistChange}
      />
      {/* 1.1.1 自定义文本框：行选择器 + 与歌名/作者同款编辑（含入字段落） */}
      <div className="text-extra-section">
        <div className="text-extra-head">
          <h3>{t('textPanel.extraTitle')}</h3>
          <div className="audio-row">
            <button
              type="button"
              className="mini-btn"
              onClick={() => props.onSelectExtraText(props.onExtraTextAdd())}
            >
              {t('textPanel.extraAdd')}
            </button>
            {props.selectedExtraTextId && (
              <button
                type="button"
                className="mini-btn danger"
                onClick={() => {
                  props.onExtraTextRemove(props.selectedExtraTextId!)
                  props.onSelectExtraText(null)
                }}
              >
                {t('textPanel.extraRemove')}
              </button>
            )}
          </div>
        </div>
        <div className="text-extra-head">
          <div className="audio-row">
            {Object.keys(props.extraTexts).map((id) => (
              <button
                key={id}
                type="button"
                className={
                  'mini-btn' + (props.selectedExtraTextId === id ? ' mini-btn-active' : '')
                }
                onClick={() => props.onSelectExtraText(id)}
              >
                {props.extraTexts[id].text || t('textPanel.extraUntitled')}
              </button>
            ))}
            {Object.keys(props.extraTexts).length === 0 && (
              <span className="panel-note">{t('textPanel.extraNone')}</span>
            )}
          </div>
        </div>
        {props.selectedExtraTextId && props.extraTexts[props.selectedExtraTextId] && (
          <StyleControls
            title={t('textPanel.extraTitle')}
            kind={'text:' + props.selectedExtraTextId}
            cfg={props.extraTexts[props.selectedExtraTextId]}
            systemFonts={sys.fonts}
            customFontFamily={props.customFontFamily}
            customFontName={props.customFontName}
            kfOps={props.kfOps}
            onChange={(patch) => props.onExtraTextChange(props.selectedExtraTextId!, patch)}
          />
        )}
      </div>
    </section>
  )
}
