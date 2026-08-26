import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { SUBTITLE_ZONE_Y } from '@shared/layout'
import { useProject } from './hooks/useProject'
import { useAudioPlayback, type PlaybackApi } from './hooks/useAudioPlayback'
import { CanvasStage } from './components/CanvasStage'
import type { SelectableId } from './components/SceneLayers'
import { InputPanel } from './components/panels/InputPanel'
import { MainImagePanel } from './components/panels/MainImagePanel'
import { BackgroundPanel } from './components/panels/BackgroundPanel'
import { TextPanel } from './components/panels/TextPanel'
import { VisualizerPanel } from './components/panels/VisualizerPanel'
import { AudioPanel } from './components/panels/AudioPanel'

const IS_VISUAL_SMOKE = new URLSearchParams(window.location.search).has('smokeVisual')

/* ================= 无头自测工具 ================= */

interface VisualCheckItem {
  label: string
  pass: boolean
  detail: string
}

interface VisualCheckReport {
  ok: boolean
  checks: VisualCheckItem[]
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function stageGeometry(stage: Konva.Stage): {
  ctx: CanvasRenderingContext2D | null
  scale: number
  offX: number
  offY: number
} {
  const canvas = stage.toCanvas({ pixelRatio: 1 })
  const ctx = canvas.getContext('2d')
  const scale = Math.min(stage.width() / 1920, stage.height() / 1080)
  const offX = (stage.width() - 1920 * scale) / 2
  const offY = (stage.height() - 1080 * scale) / 2
  return { ctx, scale, offX, offY }
}

function captureRegion(
  stage: Konva.Stage,
  x0: number,
  y0: number,
  x1: number,
  y1: number
): Uint8ClampedArray {
  const { ctx, scale, offX, offY } = stageGeometry(stage)
  if (!ctx) return new Uint8ClampedArray(0)
  return ctx.getImageData(
    Math.round(x0 * scale + offX),
    Math.round(y0 * scale + offY),
    Math.max(1, Math.round((x1 - x0) * scale)),
    Math.max(1, Math.round((y1 - y0) * scale))
  ).data
}

function countDiffPixels(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  const n = Math.min(a.length, b.length)
  let diff = 0
  for (let i = 0; i < n; i += 4) {
    if (
      Math.abs(a[i] - b[i]) > 20 ||
      Math.abs(a[i + 1] - b[i + 1]) > 20 ||
      Math.abs(a[i + 2] - b[i + 2]) > 20
    ) {
      diff++
    }
  }
  return diff
}

/** 无头像素校验：对舞台 toCanvas 取样，验证四层布局落位 */
function runVisualChecks(stage: Konva.Stage): VisualCheckReport {
  const checks: VisualCheckItem[] = []
  const fail = (label: string, detail: string): void => {
    checks.push({ label, pass: false, detail })
  }
  const pass = (label: string, detail: string): void => {
    checks.push({ label, pass: true, detail })
  }
  const { ctx, scale, offX, offY } = stageGeometry(stage)
  if (!ctx) {
    return { ok: false, checks: [{ label: 'canvas', pass: false, detail: 'getContext 失败' }] }
  }
  const sample = (x: number, y: number): number[] => {
    const d = ctx.getImageData(
      Math.round(x * scale + offX),
      Math.round(y * scale + offY),
      1,
      1
    ).data
    return [d[0], d[1], d[2], d[3]]
  }
  const countIn = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    pred: (r: number, g: number, b: number) => boolean
  ): number => {
    const img = ctx.getImageData(
      Math.round(x0 * scale + offX),
      Math.round(y0 * scale + offY),
      Math.max(1, Math.round((x1 - x0) * scale)),
      Math.max(1, Math.round((y1 - y0) * scale))
    ).data
    let n = 0
    for (let i = 0; i < img.length; i += 8) {
      if (pred(img[i], img[i + 1], img[i + 2])) n += 1
    }
    return n
  }

  const corner = sample(30, 30)
  if (corner[0] < 25 && corner[1] < 25 && corner[2] < 30) {
    fail('背景铺满', '左上角仍是画布底色 rgb(' + corner.slice(0, 3).join(',') + ')')
  } else {
    pass('背景铺满', '左上角 rgb(' + corner.slice(0, 3).join(',') + ')（封面铺满+模糊生效）')
  }

  const main = sample(441, 518)
  if (main[0] > 200 && main[1] > 200 && main[2] > 200) {
    pass('主图落位', '主图中心 rgb(' + main.slice(0, 3).join(',') + ') 为白色圆盘')
  } else {
    fail('主图落位', '主图中心 rgb(' + main.slice(0, 3).join(',') + ') 非预期亮色')
  }

  const textN = countIn(
    0.54 * 1920,
    0.12 * 1080,
    0.94 * 1920,
    0.36 * 1080,
    (r, g, b) => r > 200 && g > 200 && b > 200
  )
  if (textN > 60) {
    pass('文本层', '标题/作者区域检测到 ' + textN + ' 个亮文字像素')
  } else {
    fail('文本层', '标题/作者区域仅 ' + textN + ' 个亮像素（预期 >60）')
  }

  const vizN = countIn(
    0.49 * 1920,
    0.38 * 1080,
    0.97 * 1920,
    0.56 * 1080,
    (r, g, b) => (r > 180 && g < 170 && b > 110) || (g > 170 && b > 170 && r < 170)
  )
  if (vizN > 80) {
    pass('可视化层', '频谱区域检测到 ' + vizN + ' 个彩色柱像素')
  } else {
    fail('可视化层', '频谱区域仅 ' + vizN + ' 个彩色像素（预期 >80）')
  }

  const bottom = sample(960, 950)
  const bottomSum = bottom[0] + bottom[1] + bottom[2]
  if (bottomSum > 250) {
    pass('下半区留白', '底部中央 rgb(' + bottom.slice(0, 3).join(',') + ') 为背景')
  } else {
    fail('下半区留白', '底部中央 rgb(' + bottom.slice(0, 3).join(',') + ') 过暗')
  }

  return { ok: checks.every((c) => c.pass), checks }
}

/** 无头截图自测用合成封面：经「真实 File → blob URL」路径加载，与用户手动选封面同一条代码路径 */
function makeSyntheticCoverFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const c = document.createElement('canvas')
    c.width = 800
    c.height = 800
    const ctx = c.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    const g = ctx.createLinearGradient(0, 0, 800, 800)
    g.addColorStop(0, '#ff5f9e')
    g.addColorStop(1, '#7c3aed')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 800, 800)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(400, 400, 220, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#111827'
    ctx.textAlign = 'center'
    ctx.font = 'bold 64px "Microsoft YaHei", sans-serif'
    ctx.fillText('NIKO 封面', 400, 384)
    ctx.font = '36px sans-serif'
    ctx.fillText('SMOKE TEST', 400, 452)
    c.toBlob((blob) => {
      resolve(blob ? new File([blob], 'synthetic-cover.png', { type: 'image/png' }) : null)
    }, 'image/png')
  })
}

/** 双音调 WAV：前 1s 440Hz、后 1s 1200Hz（用于验证频谱随音频内容变化） */
function makeTwoToneWavFile(): File {
  const sr = 8000
  const n = sr * 2
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const freq = t < 1 ? 440 : 1200
    pcm[i] = Math.round(Math.sin(2 * Math.PI * freq * t) * 0.7 * 32767)
  }
  const buffer = new ArrayBuffer(44 + pcm.length * 2)
  const view = new DataView(buffer)
  const writeStr = (off: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }
  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + pcm.length * 2, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sr, true)
  view.setUint32(28, sr * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeStr(36, 'data')
  view.setUint32(40, pcm.length * 2, true)
  new Int16Array(buffer, 44).set(pcm)
  return new File([buffer], 'smoke-two-tone.wav', { type: 'audio/wav' })
}

function maxBarIndex(bars: number[]): number {
  let idx = 0
  for (let i = 1; i < bars.length; i++) if (bars[i] > bars[idx]) idx = i
  return idx
}

/** 音频 smoke：真实 WAV File → 解码 → FFT → 频谱渲染，验证两时刻可视化不同 */
async function runAudioSmoke(
  project: ReturnType<typeof useProject>,
  pbRef: React.RefObject<PlaybackApi>,
  stage: Konva.Stage
): Promise<VisualCheckReport> {
  const checks: VisualCheckItem[] = []
  const fail = (label: string, detail: string): void => {
    checks.push({ label, pass: false, detail })
  }
  const pass = (label: string, detail: string): void => {
    checks.push({ label, pass: true, detail })
  }

  project.setAudioFile(makeTwoToneWavFile())
  // 等待 React 提交 + 异步解码完成（empty/loading 期间都继续轮询）
  const t0 = Date.now()
  while (
    (pbRef.current.status === 'empty' || pbRef.current.status === 'loading') &&
    Date.now() - t0 < 10000
  ) {
    await sleep(120)
  }
  if (pbRef.current.status !== 'ready') {
    fail('音频解码', 'status=' + pbRef.current.status + ' err=' + pbRef.current.error)
    return { ok: false, checks }
  }
  pass('音频解码', 'WAV 解码成功，时长 ' + pbRef.current.duration.toFixed(2) + 's')

  const vizX0 = 0.49 * 1920
  const vizY0 = 0.38 * 1080
  const vizX1 = 0.97 * 1920
  const vizY1 = 0.56 * 1080

  // 时刻 1：440Hz 段（seek 两次让时间平滑收敛到目标频谱）
  pbRef.current.seek(0.45)
  await sleep(250)
  pbRef.current.seek(0.45)
  await sleep(300)
  const bars1 = pbRef.current.bars.slice()
  const cap1 = captureRegion(stage, vizX0, vizY0, vizX1, vizY1)
  const hasSignal1 = bars1.some((v) => v > 0.05)
  if (!hasSignal1) {
    fail('频谱 t=0.45s', '柱全为 0，FFT 未输出信号')
  } else {
    pass(
      '频谱 t=0.45s',
      '峰值柱 #' + maxBarIndex(bars1) + ' 高度 ' + bars1[maxBarIndex(bars1)].toFixed(2)
    )
  }

  // 时刻 2：1200Hz 段（不同频率 → 峰值柱位置应变化）
  pbRef.current.seek(1.45)
  await sleep(250)
  pbRef.current.seek(1.45)
  await sleep(300)
  const bars2 = pbRef.current.bars.slice()
  const cap2 = captureRegion(stage, vizX0, vizY0, vizX1, vizY1)
  const hasSignal2 = bars2.some((v) => v > 0.05)
  if (!hasSignal2) {
    fail('频谱 t=1.45s', '柱全为 0，FFT 未输出信号')
  } else {
    pass(
      '频谱 t=1.45s',
      '峰值柱 #' + maxBarIndex(bars2) + ' 高度 ' + bars2[maxBarIndex(bars2)].toFixed(2)
    )
  }

  const peakMoved = hasSignal1 && hasSignal2 && maxBarIndex(bars1) !== maxBarIndex(bars2)
  if (peakMoved) {
    pass('频谱随频率变化', '峰值柱从 #' + maxBarIndex(bars1) + ' 移到 #' + maxBarIndex(bars2))
  } else {
    fail('频谱随频率变化', '两时刻峰值柱位置相同（#' + maxBarIndex(bars1) + '）')
  }

  const diffPx = countDiffPixels(cap1, cap2)
  if (diffPx > 150) {
    pass('可视化动态渲染', '两时刻频谱区域差异像素 ' + diffPx + ' 个')
  } else {
    fail('可视化动态渲染', '两时刻频谱区域仅 ' + diffPx + ' 个差异像素（预期 >150）')
  }

  // 回归：播放中 seek 不得被旧音源 onended 误判为播完（曾跳到结尾并停止）
  pbRef.current.seek(0.2)
  pbRef.current.play()
  await sleep(400)
  const tBeforeSeek = pbRef.current.currentTime
  pbRef.current.seek(1.1)
  await sleep(400)
  const tAfterSeek = pbRef.current.currentTime
  const stillPlaying = pbRef.current.isPlaying
  pbRef.current.pause()
  if (stillPlaying && tAfterSeek >= 1.05 && tAfterSeek < 1.6) {
    pass('播放中 seek 不中断', 'seek 后继续播放，currentTime=' + tAfterSeek.toFixed(2) + 's')
  } else {
    fail(
      '播放中 seek 不中断',
      'isPlaying=' +
        stillPlaying +
        ' currentTime=' +
        tAfterSeek.toFixed(2) +
        's（seek 前 ' +
        tBeforeSeek.toFixed(2) +
        's）'
    )
  }

  return { ok: checks.every((c) => c.pass), checks }
}

/* ================= 应用 ================= */

function App(): React.JSX.Element {
  const project = useProject()
  const [selectedId, setSelectedId] = useState<SelectableId>(null)
  const stageRef = useRef<Konva.Stage | null>(null)
  const pb = useAudioPlayback(project.assets.audioFile, project.layout.visualizer)
  const pbRef = useRef<PlaybackApi>(pb)

  useEffect(() => {
    pbRef.current = pb
  }, [pb])

  // 渲染期直接派生：主图是否进入下半区（y>55% 仅警告）
  const subzoneWarning = project.layout.mainImage.rect.y > SUBTITLE_ZONE_Y

  useEffect(() => {
    if (!IS_VISUAL_SMOKE) return
    void (async () => {
      const file = await makeSyntheticCoverFile()
      if (file) project.setCoverFile(file)
    })()
    window.__captureStage = () => stageRef.current?.toDataURL({ pixelRatio: 1 }) ?? ''
    window.__runVisualChecks = () =>
      stageRef.current ? runVisualChecks(stageRef.current) : { ok: false, checks: [] }
    window.__runAudioSmoke = () =>
      stageRef.current
        ? runAudioSmoke(project, pbRef, stageRef.current)
        : Promise.resolve({ ok: false, checks: [] })
    return () => {
      delete window.__captureStage
      delete window.__runVisualChecks
      delete window.__runAudioSmoke
    }
    // 仅无头自测模式生效，project 引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">NikoKaraokeVideoMaker</h1>
        <span className="app-stage-tag">M3 · 文本样式 + 频谱可视化 + 预览播放</span>
      </header>
      <div className="app-body">
        <aside className="side-panel">
          <InputPanel
            songTitle={project.layout.texts.songTitle.text}
            artist={project.layout.texts.artist.text}
            coverUrl={project.assets.coverUrl}
            coverFile={project.assets.coverFile}
            audioFile={project.assets.audioFile}
            fileError={project.fileError}
            onSongTitleChange={(t) => project.updateText('songTitle', { text: t })}
            onArtistChange={(t) => project.updateText('artist', { text: t })}
            onCoverFile={(f) => void project.setCoverFile(f)}
            onAudioFile={(f) => void project.setAudioFile(f)}
          />
          <AudioPanel
            status={pb.status}
            error={pb.error}
            duration={pb.duration}
            currentTime={pb.currentTime}
            isPlaying={pb.isPlaying}
            fileName={project.assets.audioFile?.name ?? null}
            onPlay={pb.play}
            onPause={pb.pause}
            onSeek={pb.seek}
          />
          <MainImagePanel mainImage={project.layout.mainImage} onChange={project.updateMainImage} />
          <BackgroundPanel
            background={project.layout.background}
            onChange={project.updateBackground}
          />
          <TextPanel
            songTitle={project.layout.texts.songTitle}
            artist={project.layout.texts.artist}
            onSongTitleChange={(p) => project.updateText('songTitle', p)}
            onArtistChange={(p) => project.updateText('artist', p)}
          />
          <VisualizerPanel config={project.layout.visualizer} onChange={project.updateVisualizer} />
        </aside>
        <main className="canvas-wrap">
          <CanvasStage
            layout={project.layout}
            coverElement={project.assets.coverElement}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMainRectChange={project.updateMainRect}
            onTextRectChange={(kind, rect) => project.updateText(kind, { rect })}
            onVisualizerRectChange={(rect) => project.updateVisualizer({ rect })}
            bars={pb.bars}
            onStageReady={(s) => {
              stageRef.current = s
            }}
          />
          {subzoneWarning && (
            <div className="warn-banner">
              ⚠ 主图已进入下半区（y&gt;55%，预留字幕区）——仅提醒，不禁止。
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

export default App
