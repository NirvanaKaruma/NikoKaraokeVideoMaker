import { useState } from 'react'
import type {
  BackgroundConfig,
  BeatFxConfig,
  CanvasFxConfig,
  IntroOutroConfig,
  MainImageConfig,
  ParticlePreset,
  TextLayerConfig,
  VisualizerConfig
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
  beat: BeatFxConfig
  visualizer: VisualizerConfig
  onBgFxChange: (p: Partial<BackgroundConfig['fx']>) => void
  onImageFxChange: (p: Partial<MainImageConfig['fx']>) => void
  onSongTitleEntryChange: (p: Partial<TextLayerConfig['entry']>) => void
  onArtistEntryChange: (p: Partial<TextLayerConfig['entry']>) => void
  onCanvasFxChange: (p: Partial<CanvasFxConfig>) => void
  onIntroOutroChange: (p: Partial<IntroOutroConfig>) => void
  onBeatFxChange: (p: Partial<BeatFxConfig>) => void
  onVisualizerChange: (p: Partial<VisualizerConfig>) => void
}

const PARTICLE_PRESETS: { value: ParticlePreset; labelKey: string }[] = [
  { value: 'snow', labelKey: 'fx.beat.presetSnow' },
  { value: 'sakura', labelKey: 'fx.beat.presetSakura' },
  { value: 'star', labelKey: 'fx.beat.presetStar' },
  { value: 'bubble', labelKey: 'fx.beat.presetBubble' }
]

/** 自由正数输入（BPM / 周期秒：不做范围限制，仅校验 >0 且有限；空串=null 关闭） */
function FreeNumberField({
  label,
  value,
  placeholder,
  onCommit
}: {
  label: string
  value: number | null
  placeholder: string
  onCommit: (v: number | null) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string>(value == null ? '' : String(value))
  const commit = (): void => {
    const trimmed = draft.trim()
    if (trimmed === '') {
      onCommit(null)
      return
    }
    const n = Number(trimmed)
    if (Number.isFinite(n) && n > 0) {
      onCommit(n)
    } else {
      setDraft(value == null ? '' : String(value)) // 非法输入回退
    }
  }
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        step="any"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
      />
    </label>
  )
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
  const { backgroundFx, imageFx, canvasFx, introOutro, beat, visualizer } = props
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

      <h2>{t('fx.beatTitle')}</h2>
      <FreeNumberField
        label={t('fx.beat.bpm')}
        value={visualizer.bpm}
        placeholder={t('fx.beat.bpmPlaceholder')}
        onCommit={(v) => props.onVisualizerChange({ bpm: v })}
      />
      <FreeNumberField
        label={t('fx.beat.interval')}
        value={visualizer.beatIntervalSec}
        placeholder={t('fx.beat.intervalPlaceholder')}
        onCommit={(v) => props.onVisualizerChange({ beatIntervalSec: v })}
      />
      <p className="panel-note">{t('fx.beat.note')}</p>
      <DeferredSlider
        label={(v) => t('fx.beat.pulse', { v: Math.round(v * 100) })}
        value={beat.pulse}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBeatFxChange({ pulse: v })}
      />
      <DeferredSlider
        label={(v) => t('fx.beat.burst', { v: Math.round(v * 100) })}
        value={beat.burst}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBeatFxChange({ burst: v })}
      />
      <label className="field">
        <span>{t('fx.beat.particlePreset')}</span>
        <select
          value={beat.particlePreset}
          onChange={(e) =>
            props.onBeatFxChange({ particlePreset: e.target.value as ParticlePreset })
          }
        >
          {PARTICLE_PRESETS.map((o) => (
            <option key={o.value} value={o.value}>
              {t(o.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <DeferredSlider
        label={(v) => t('fx.beat.particleDensity', { v: Math.round(v * 100) })}
        value={beat.particleDensity}
        min={0}
        max={1}
        step={0.01}
        onCommit={(v) => props.onBeatFxChange({ particleDensity: v })}
      />
    </section>
  )
}
