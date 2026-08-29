import { useState } from 'react'
import type {
  BackgroundConfig,
  MainImageConfig,
  TextLayerConfig,
  VisualizerConfig
} from '@shared/layout'
import { useLocale } from '../hooks/useLocale'
import type { AudioStatus } from '../hooks/useAudioPlayback'
import { AudioPanel } from './panels/AudioPanel'
import { InputPanel } from './panels/InputPanel'
import { OverlayPanel } from './panels/OverlayPanel'
import { MainImagePanel } from './panels/MainImagePanel'
import { BackgroundPanel } from './panels/BackgroundPanel'
import { TextPanel } from './panels/TextPanel'
import { VisualizerPanel } from './panels/VisualizerPanel'
import { FxPanel } from './panels/FxPanel'
import type {
  AudioEngineConfig,
  BeatFxConfig,
  CanvasFxConfig,
  IntroOutroConfig,
  OverlayLayerConfig
} from '@shared/layout'
import type { SelectableId } from './SceneLayers'

export type SideTab = 'assets' | 'text' | 'visualizer' | 'fx'

export interface SidePanelProps {
  // 附加图层（0.8.0）
  overlayLayers: OverlayLayerConfig[]
  overlayImageUrls: Record<string, string | null>
  selectedId: SelectableId
  onOverlaySelect: (id: SelectableId) => void
  onOverlayAdd: () => string
  onOverlayPickImage: (id: string, file: File | null) => void
  onOverlayUpdate: (id: string, patch: Partial<OverlayLayerConfig>) => void
  onOverlayRemove: (id: string) => void
  onOverlayMove: (id: string, dir: -1 | 1) => void
  // 输入
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
  // 播放
  audioStatus: AudioStatus
  audioError: string | null
  /** 超长音频警告（0.7.0 护栏） */
  audioWarning: string | null
  duration: number
  /** 播放时间轴总长（音频 + 前导，秒）——进度/时间显示用 */
  timelineDuration: number
  currentTime: number
  isPlaying: boolean
  audioFileName: string | null
  onPlay: () => void
  onPause: () => void
  onSeek: (t: number) => void
  // 主图 / 背景
  mainImage: MainImageConfig
  onMainImageChange: (patch: Partial<MainImageConfig>) => void
  background: BackgroundConfig
  bgUrl: string | null
  bgFile: File | null
  onBackgroundChange: (patch: Partial<BackgroundConfig>) => void
  onBgFile: (f: File | null) => void
  onClearBg: () => void
  // 文本
  songTitleCfg: TextLayerConfig
  artistCfg: TextLayerConfig
  onSongTitleCfgChange: (p: Partial<TextLayerConfig>) => void
  onArtistCfgChange: (p: Partial<TextLayerConfig>) => void
  // 可视化
  visualizer: VisualizerConfig
  onVisualizerChange: (patch: Partial<VisualizerConfig>) => void
  // 动效（0.5.0）
  backgroundFx: BackgroundConfig['fx']
  imageFx: MainImageConfig['fx']
  songTitleEntry: TextLayerConfig['entry']
  artistEntry: TextLayerConfig['entry']
  canvasFx: CanvasFxConfig
  introOutro: IntroOutroConfig
  onBackgroundFxChange: (patch: Partial<BackgroundConfig['fx']>) => void
  onImageFxChange: (patch: Partial<MainImageConfig['fx']>) => void
  onSongTitleEntryChange: (patch: Partial<TextLayerConfig['entry']>) => void
  onArtistEntryChange: (patch: Partial<TextLayerConfig['entry']>) => void
  onCanvasFxChange: (patch: Partial<CanvasFxConfig>) => void
  onIntroOutroChange: (patch: Partial<IntroOutroConfig>) => void
  // 音频工程（0.7.0）
  audio: AudioEngineConfig
  onAudioChange: (patch: Partial<AudioEngineConfig>) => void
  // 音乐响应（0.5.0）
  beat: BeatFxConfig
  visualizerForBeat: VisualizerConfig
  onBeatFxChange: (patch: Partial<BeatFxConfig>) => void
  onVisualizerForBeatChange: (patch: Partial<VisualizerConfig>) => void
}

const TABS: { id: SideTab; labelKey: string }[] = [
  { id: 'assets', labelKey: 'tabs.assets' },
  { id: 'text', labelKey: 'tabs.text' },
  { id: 'visualizer', labelKey: 'tabs.visualizer' },
  { id: 'fx', labelKey: 'tabs.fx' }
]

/** 左侧面板：常驻播放控制 + 分类 tab（M5 UI 重构：避免单列无限堆叠） */
export function SidePanel(props: SidePanelProps): React.JSX.Element {
  const { t } = useLocale()
  const [tab, setTab] = useState<SideTab>('assets')
  return (
    <aside className="side-panel">
      <AudioPanel
        status={props.audioStatus}
        error={props.audioError}
        duration={props.duration}
        timelineDuration={props.timelineDuration}
        currentTime={props.currentTime}
        isPlaying={props.isPlaying}
        fileName={props.audioFileName}
        onPlay={props.onPlay}
        onPause={props.onPause}
        onSeek={props.onSeek}
        offsetMs={props.visualizer.offsetMs}
        onOffsetChange={(v) => props.onVisualizerChange({ offsetMs: v })}
        warning={props.audioWarning}
      />
      <div className="tab-bar">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'tab' + (tab === item.id ? ' active' : '')}
            onClick={() => setTab(item.id)}
          >
            {t(item.labelKey)}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {tab === 'assets' && (
          <>
            <InputPanel
              songTitle={props.songTitle}
              artist={props.artist}
              coverUrl={props.coverUrl}
              coverFile={props.coverFile}
              audioFile={props.audioFile}
              fileError={props.fileError}
              onSongTitleChange={props.onSongTitleChange}
              onArtistChange={props.onArtistChange}
              onCoverFile={props.onCoverFile}
              onAudioFile={props.onAudioFile}
            />
            <MainImagePanel mainImage={props.mainImage} onChange={props.onMainImageChange} />
            <OverlayPanel
              layers={props.overlayLayers}
              imageUrls={props.overlayImageUrls}
              selectedId={props.selectedId}
              onSelect={props.onOverlaySelect}
              onAdd={props.onOverlayAdd}
              onPickImage={props.onOverlayPickImage}
              onUpdate={props.onOverlayUpdate}
              onRemove={props.onOverlayRemove}
              onMove={props.onOverlayMove}
            />
            <BackgroundPanel
              background={props.background}
              bgUrl={props.bgUrl}
              bgFile={props.bgFile}
              onChange={props.onBackgroundChange}
              onBgFile={props.onBgFile}
              onClearBg={props.onClearBg}
            />
          </>
        )}
        {tab === 'text' && (
          <TextPanel
            songTitle={props.songTitleCfg}
            artist={props.artistCfg}
            onSongTitleChange={props.onSongTitleCfgChange}
            onArtistChange={props.onArtistCfgChange}
          />
        )}
        {tab === 'visualizer' && (
          <VisualizerPanel config={props.visualizer} onChange={props.onVisualizerChange} />
        )}
        {tab === 'fx' && (
          <FxPanel
            backgroundFx={props.backgroundFx}
            imageFx={props.imageFx}
            songTitleEntry={props.songTitleEntry}
            artistEntry={props.artistEntry}
            canvasFx={props.canvasFx}
            introOutro={props.introOutro}
            onBgFxChange={props.onBackgroundFxChange}
            onImageFxChange={props.onImageFxChange}
            onSongTitleEntryChange={props.onSongTitleEntryChange}
            onArtistEntryChange={props.onArtistEntryChange}
            onCanvasFxChange={props.onCanvasFxChange}
            onIntroOutroChange={props.onIntroOutroChange}
            audio={props.audio}
            onAudioChange={props.onAudioChange}
            beat={props.beat}
            visualizer={props.visualizerForBeat}
            onBeatFxChange={props.onBeatFxChange}
            onVisualizerChange={props.onVisualizerForBeatChange}
          />
        )}
      </div>
    </aside>
  )
}
