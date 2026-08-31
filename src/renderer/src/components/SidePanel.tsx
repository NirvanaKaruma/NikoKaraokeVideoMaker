import { useEffect, useRef, useState } from 'react'
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
import { LayerPanel, type LayerRow } from './panels/LayerPanel'
import { MainImagePanel } from './panels/MainImagePanel'
import { BackgroundPanel } from './panels/BackgroundPanel'
import { TextPanel } from './panels/TextPanel'
import { VisualizerPanel } from './panels/VisualizerPanel'
import { FxPanel } from './panels/FxPanel'
import { KeyframePanel } from './panels/KeyframePanel'
import type {
  AudioEngineConfig,
  BeatFxConfig,
  CanvasFxConfig,
  IntroOutroConfig,
  OverlayLayerConfig,
  ProjectLayout
} from '@shared/layout'
import type { CutTransitionSpec, PropertyTrack } from '@shared/timeline'
import type { SelectableId } from './SceneLayers'

export type SideTab = 'assets' | 'layers' | 'text' | 'visualizer' | 'fx' | 'keyframes'

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
  /** 1.1.1 图层页统一入口（新增/删除图层） */
  onAddOverlay: () => string
  onAddText: () => string
  onRemoveLayer: (id: string) => void
  /** 1.1.1 外部请求切换面板 tab（{tab, nonce}；nonce 每次请求递增） */
  pendingTab?: { tab: SideTab; nonce: number } | null
  // 图层面板（0.9.0）
  layerRows: LayerRow[]
  snapEnabled: boolean
  onLayerToggleHidden: (id: string) => void
  onLayerToggleLocked: (id: string) => void
  onLayerMove: (id: string, dir: -1 | 1) => void
  onSnapToggle: (v: boolean) => void
  // 自定义字体（0.8.0）
  customFontFamily: string | null
  customFontName: string | null
  onPickFont: (file: File | null) => void
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
  /** 1.1.1 自定义文本框 */
  extraTexts: Record<string, TextLayerConfig>
  selectedExtraTextId: string | null
  onSelectExtraText: (id: string | null) => void
  onExtraTextChange: (id: string, patch: Partial<TextLayerConfig>) => void
  onExtraTextAdd: () => string
  onExtraTextRemove: (id: string) => void
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
  // 编辑上下文（1.0.0 T4）：当前编辑对象条
  editLabel: string
  editIsSegment: boolean
  onEditGlobal: () => void
  /** 取消关键帧选择（回到段落/全局编辑上下文） */
  onKfClear: () => void
  // 关键帧编辑器（1.0.0 T5）
  kfSegId: string | null
  kfSegStartSec: number
  kfSegEndSec: number
  kfDurationSec: number
  kfTracks: PropertyTrack[]
  kfView: ProjectLayout
  onKfTracksChange: (tracks: PropertyTrack[]) => void
  /** 选中关键帧（绝对秒；编辑对象条显式显示「段落N · 关键帧 t=」） */
  kfSelT: number | null
  onKfSelTChange: (t: number | null) => void
  /** 面板修改自动创建关键帧 */
  kfAuto: boolean
  onKfAutoChange: (on: boolean) => void
  /** 空帧槽（段内=相对秒；全局=绝对秒） */
  kfFrameSlots: number[]
  onKfFrameSlotsChange: (slots: number[]) => void
  /** 裸建关键帧（绝对秒；App 路由段/全局） */
  onKfAddEmptyFrame: (tAbs: number) => void
  /** 段属性过渡（v5：过渡属于段落本身；目标跟随场景——相接段或全局基线） */
  kfTransitionIn?: CutTransitionSpec | null
  kfTransitionOut?: CutTransitionSpec | null
  onKfTransitionChange?: (boundary: 'in' | 'out', patch: Partial<CutTransitionSpec>) => void
}

const TABS: { id: SideTab; labelKey: string }[] = [
  { id: 'assets', labelKey: 'tabs.assets' },
  { id: 'layers', labelKey: 'layers.tab' },
  { id: 'text', labelKey: 'tabs.text' },
  { id: 'visualizer', labelKey: 'tabs.visualizer' },
  { id: 'fx', labelKey: 'tabs.fx' },
  { id: 'keyframes', labelKey: 'tabs.keyframes' }
]

/** 左侧面板：常驻播放控制 + 分类 tab（M5 UI 重构：避免单列无限堆叠） */
export function SidePanel(props: SidePanelProps): React.JSX.Element {
  const { t } = useLocale()
  const [tab, setTab] = useState<SideTab>('assets')
  // 1.1.1 外部请求切页（图层页新增后自动跳对应编辑面板）：pendingTab 带自增 nonce 去重
  const lastTabNonceRef = useRef(-1)
  useEffect(() => {
    if (props.pendingTab && props.pendingTab.nonce !== lastTabNonceRef.current) {
      lastTabNonceRef.current = props.pendingTab.nonce
      setTab(props.pendingTab.tab)
    }
  }, [props.pendingTab])
  return (
    <aside className="side-panel">
      <div className="edit-ctx-bar">
        <span className="edit-ctx-label">{t('timeline.editTarget')}</span>
        <span className={'edit-ctx-value' + (props.editIsSegment ? ' seg' : '')}>
          {props.editLabel}
        </span>
        {props.editIsSegment && (
          <button type="button" className="mini-btn" onClick={props.onEditGlobal}>
            {t('timeline.editGlobal')}
          </button>
        )}
        {props.kfSelT != null && (
          <button type="button" className="mini-btn" onClick={props.onKfClear}>
            ✕ {t('kf.clearKf')}
          </button>
        )}
      </div>
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
        {tab === 'layers' && (
          <LayerPanel
            rows={props.layerRows}
            snapEnabled={props.snapEnabled}
            onToggleHidden={props.onLayerToggleHidden}
            onToggleLocked={props.onLayerToggleLocked}
            onMove={props.onLayerMove}
            onSnapToggle={props.onSnapToggle}
            onAddOverlay={props.onAddOverlay}
            onAddText={props.onAddText}
            onRemove={props.onRemoveLayer}
          />
        )}
        {tab === 'text' && (
          <TextPanel
            songTitle={props.songTitleCfg}
            artist={props.artistCfg}
            onSongTitleChange={props.onSongTitleCfgChange}
            onArtistChange={props.onArtistCfgChange}
            extraTexts={props.extraTexts}
            selectedExtraTextId={props.selectedExtraTextId}
            onSelectExtraText={props.onSelectExtraText}
            onExtraTextChange={props.onExtraTextChange}
            onExtraTextAdd={props.onExtraTextAdd}
            onExtraTextRemove={props.onExtraTextRemove}
            customFontFamily={props.customFontFamily}
            customFontName={props.customFontName}
            onPickFont={props.onPickFont}
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
        {tab === 'keyframes' && (
          <KeyframePanel
            segId={props.kfSegId}
            segStartSec={props.kfSegStartSec}
            segEndSec={props.kfSegEndSec}
            durationSec={props.kfDurationSec}
            tracks={props.kfTracks}
            currentT={props.currentTime}
            view={props.kfView}
            onTracksChange={props.onKfTracksChange}
            selT={props.kfSelT}
            onSelTChange={props.onKfSelTChange}
            kfAuto={props.kfAuto}
            onKfAutoChange={props.onKfAutoChange}
            frameSlots={props.kfFrameSlots}
            onFrameSlotsChange={props.onKfFrameSlotsChange}
            onAddEmptyFrame={props.onKfAddEmptyFrame}
            transitionIn={props.kfTransitionIn}
            transitionOut={props.kfTransitionOut}
            onTransitionChange={props.onKfTransitionChange}
          />
        )}
      </div>
    </aside>
  )
}
