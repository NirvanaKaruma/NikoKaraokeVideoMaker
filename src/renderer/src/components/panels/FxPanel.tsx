import type {
  BackgroundConfig,
  CanvasFxConfig,
  IntroOutroConfig,
  MainImageConfig,
  TextLayerConfig
} from '@shared/layout'
import type { EntryStyle } from '@shared/fx'
import { useLocale } from '../../hooks/useLocale'
import { DeferredSlider } from '../DeferredSlider'

export interface FxPanelProps {
  backgroundFx: BackgroundConfig['fx']
  imageFx: MainImageConfig['fx']
  songTitleEntry: TextLayerConfig['entry']
  artistEntry: TextLayerConfig['entry']
  canvasFx: CanvasFxConfig
  introOutro: IntroOutroConfig
  onBgFxChange: (p: Partial<BackgroundConfig['fx']>) => void
  onImageFxChange: (p: Partial<MainImageConfig['fx']>) => void
  onSongTitleEntryChange: (p: Partial<TextLayerConfig['entry']>) => void
  onArtistEntryChange: (p: Partial<TextLayerConfig['entry']>) => void
  onCanvasFxChange: (p: Partial<CanvasFxConfig>) => void
  onIntroOutroChange: (p: Partial<IntroOutroConfig>) => void
}

/** 入场动画类型选项（与 TextLayerConfig.entry.type 对齐；bounce=整体回弹，见偏差记录） */
const ENTRY_TYPES: { value: EntryStyle; labelKey: string }[] = [
  { value: 'none', labelKey: 'fx.entry.none' },
  { value: 'fade', labelKey: 'fx.entry.fade' },
  { value: 'slide', labelKey: 'fx.entry.slide' },
  { value: 'typewriter', labelKey: 'fx.entry.typewriter' },
  { value: 'bounce', labelKey: 'fx.entry.bounce' }
]

const MASKS: { value: MainImageConfig['fx']['mask']; labelKey: string }[] = [
  { value: 'none', labelKey: 'fx.img.maskNone' },
  { value: 'circle', labelKey: 'fx.img.maskCircle' },
  { value: 'star', labelKey: 'fx.img.maskStar' }
]

function EntryBlock({
  title,
  entry,
  onChange
}: {
  title: string
  entry: TextLayerConfig['entry']
  onChange: (p: Partial<TextLayerConfig['entry']>) => void
}): React.JSX.Element {
  const { t } = useLocale()
  return (
    <div className="field">
      <span>{title}</span>
      <select value={entry.type} onChange={(e) => onChange({ type: e.target.value as EntryStyle })}>
        {ENTRY_TYPES.map((o) => (
          <option key={o.value} value={o.value}>
            {t(o.labelKey)}
          </option>
        ))}
      </select>
      <DeferredSlider
        label={(v) => t('fx.entry.durationSec', { v: Math.round(v * 10) / 10 })}
        value={entry.durationSec}
        min={0.3}
        max={5}
        step={0.1}
        onCommit={(v) => onChange({ durationSec: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.entry.delaySec', { v: Math.round(v * 10) / 10 })}
        value={entry.delaySec}
        min={0}
        max={5}
        step={0.1}
        onCommit={(v) => onChange({ delaySec: v })}
      />
    </div>
  )
}

/** 动效面板（0.5.0）：背景 / 主图 / 文本入场 / 全局后期 / 片头片尾（全部默认关闭） */
export function FxPanel(props: FxPanelProps): React.JSX.Element {
  const { t } = useLocale()
  const { backgroundFx, imageFx, canvasFx, introOutro } = props
  return (
    <section className="panel-section">
      <h2>{t('fx.bgTitle')}</h2>
      <DeferredSlider
        label={(v) => t('fx.bg.kenBurns', { v: Math.round(v * 100) })}
        value={backgroundFx.kenBurns}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBgFxChange({ kenBurns: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.bg.kenBurnsDuration', { v: Math.round(v) })}
        value={backgroundFx.kenBurnsDuration}
        min={5}
        max={120}
        step={1}
        onCommit={(v) => props.onBgFxChange({ kenBurnsDuration: Math.round(v) })}
      />
      <DeferredSlider
        label={(v) => t('fx.bg.bassBrightness', { v: Math.round(v * 100) })}
        value={backgroundFx.bassBrightness}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBgFxChange({ bassBrightness: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.bg.bassHue', { v: Math.round(v * 100) })}
        value={backgroundFx.bassHue}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBgFxChange({ bassHue: v })}
      />

      <h2>{t('fx.imgTitle')}</h2>
      <DeferredSlider
        label={(v) => t('fx.img.breathe', { v: Math.round(v * 100) })}
        value={imageFx.breathe}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onImageFxChange({ breathe: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.img.breathePeriod', { v: Math.round(v * 10) / 10 })}
        value={imageFx.breathePeriod}
        min={1}
        max={16}
        step={0.1}
        onCommit={(v) => props.onImageFxChange({ breathePeriod: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.img.rotateDeg', { v: Math.round(v * 10) / 10 })}
        value={imageFx.rotateDeg}
        min={0}
        max={10}
        step={0.1}
        onCommit={(v) => props.onImageFxChange({ rotateDeg: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.img.glowPulse', { v: Math.round(v * 100) })}
        value={imageFx.glowPulse}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onImageFxChange({ glowPulse: v })}
      />
      <label className="field">
        <span>{t('fx.img.mask')}</span>
        <select
          value={imageFx.mask}
          onChange={(e) =>
            props.onImageFxChange({ mask: e.target.value as MainImageConfig['fx']['mask'] })
          }
        >
          {MASKS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <DeferredSlider
        label={(v) => t('fx.img.border', { v: Math.round(v * 100) })}
        value={imageFx.border}
        min={0}
        max={0.02}
        step={0.0005}
        onCommit={(v) => props.onImageFxChange({ border: v })}
      />
      <label className="field">
        <span>{t('fx.img.borderColor')}</span>
        <input
          type="color"
          value={imageFx.borderColor}
          onInput={(e) => props.onImageFxChange({ borderColor: e.currentTarget.value })}
        />
      </label>

      <h2>{t('fx.entryTitle')}</h2>
      <EntryBlock
        title={t('textPanel.songTitle')}
        entry={props.songTitleEntry}
        onChange={props.onSongTitleEntryChange}
      />
      <EntryBlock
        title={t('textPanel.artist')}
        entry={props.artistEntry}
        onChange={props.onArtistEntryChange}
      />

      <h2>{t('fx.canvasTitle')}</h2>
      <DeferredSlider
        label={(v) => t('fx.canvas.vignette', { v: Math.round(v * 100) })}
        value={canvasFx.vignette}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onCanvasFxChange({ vignette: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.canvas.grain', { v: Math.round(v * 100) })}
        value={canvasFx.grain}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onCanvasFxChange({ grain: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.canvas.scanline', { v: Math.round(v * 100) })}
        value={canvasFx.scanline}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onCanvasFxChange({ scanline: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.canvas.beatFlash', { v: Math.round(v * 100) })}
        value={canvasFx.beatFlash}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onCanvasFxChange({ beatFlash: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.canvas.lightLeak', { v: Math.round(v * 100) })}
        value={canvasFx.lightLeak}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onCanvasFxChange({ lightLeak: v })}
      />
      <p className="panel-note">{t('fx.canvas.note')}</p>

      <h2>{t('fx.introTitle')}</h2>
      <DeferredSlider
        label={(v) => t('fx.introOutro.introFade', { v: Math.round(v * 10) / 10 })}
        value={introOutro.introFade}
        min={0}
        max={5}
        step={0.1}
        onCommit={(v) => props.onIntroOutroChange({ introFade: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.introOutro.introTitleCard', { v: Math.round(v * 10) / 10 })}
        value={introOutro.introTitleCard}
        min={0}
        max={10}
        step={0.1}
        onCommit={(v) => props.onIntroOutroChange({ introTitleCard: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.introOutro.outroFade', { v: Math.round(v * 10) / 10 })}
        value={introOutro.outroFade}
        min={0}
        max={5}
        step={0.1}
        onCommit={(v) => props.onIntroOutroChange({ outroFade: v })}
      />
      <p className="panel-note">{t('fx.introOutro.note')}</p>
    </section>
  )
}
