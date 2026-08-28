import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { SUBTITLE_ZONE_Y } from '@shared/layout'
import { useLocale } from './hooks/useLocale'
import { useProject } from './hooks/useProject'
import { useAudioPlayback, type PlaybackApi } from './hooks/useAudioPlayback'
import { useFfmpegDownload, useFfmpegStatus } from './hooks/useFfmpeg'
import { useExporter } from './hooks/useExporter'
import { benchmarkEncoder } from './export/exportVideo'
import { CanvasStage } from './components/CanvasStage'
import { ExportStageHost } from './components/ExportStageHost'
import { SidePanel } from './components/SidePanel'
import { ExportDialog } from './components/ExportDialog'
import { SettingsDialog } from './components/SettingsDialog'
import type { SelectableId } from './components/SceneLayers'
import { HelpDialog } from './components/HelpDialog'

const IS_VISUAL_SMOKE = new URLSearchParams(window.location.search).has('smokeVisual')
const IS_SMOKE_EXPORT = new URLSearchParams(window.location.search).has('smokeExport')
const IS_SMOKE_PROJECT = new URLSearchParams(window.location.search).has('smokeProject')

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

/** 无头自测用 sleep：MessageChannel 版（隐藏窗口 setTimeout 会被 Chromium 节流到分钟级） */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const mc = new MessageChannel()
    const start = performance.now()
    const tick = (): void => {
      if (performance.now() - start >= ms) {
        resolve()
        return
      }
      const next = new MessageChannel()
      next.port1.onmessage = () => tick()
      next.port2.postMessage(0)
    }
    mc.port1.onmessage = () => tick()
    mc.port2.postMessage(0)
  })
}

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
  // 诊断：主图区域内占位文案灰蓝色像素（#7a808d 附近）——出现即说明封面未加载、显示的是占位框
  const placeholderN = countIn(
    0.04 * 1920,
    0.03 * 1080,
    0.42 * 1920,
    0.93 * 1080,
    (r, g, b) =>
      r > 100 && r < 160 && g > 105 && g < 165 && b > 115 && b < 175 && Math.abs(r - b) < 30
  )
  if (main[0] > 200 && main[1] > 200 && main[2] > 200) {
    pass('主图落位', '主图中心 rgb(' + main.slice(0, 3).join(',') + ') 为白色圆盘')
  } else {
    fail(
      '主图落位',
      '主图中心 rgb(' +
        main.slice(0, 3).join(',') +
        ') 非预期亮色；占位灰蓝像素 ' +
        placeholderN +
        '（>50 说明封面未加载）'
    )
  }

  // 交互回归：文本区域应可命中（曾有回归：文本框子元素全 listening=false 导致不可选中）
  const hitCheck = (() => {
    try {
      const hp = stage.getIntersection({
        x: Math.round(0.7 * 1920 * scale + offX),
        y: Math.round(0.18 * 1080 * scale + offY)
      })
      return !!hp && hp.getLayer()?.name() === 'text'
    } catch {
      return false
    }
  })()
  if (hitCheck) {
    pass('文本可选中', '歌名区域命中检测通过（文字层节点）')
  } else {
    fail('文本可选中', '歌名区域无命中节点（文本框不可选中）')
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

/** 双音调 WAV：前半 440Hz、后半 1200Hz（验证频谱随音频内容变化 / 导出测试素材） */
function makeTwoToneWavFile(durationSec = 2, sampleRate = 8000): File {
  const sr = sampleRate
  const n = Math.round(sr * durationSec)
  const pcm = new Int16Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const freq = t < durationSec / 2 ? 440 : 1200
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

  // 频率范围可调（用户反馈）：收窄范围 → 同一音高峰值柱位右移；柱组按新配置即时重算（不再"拉宽/压扁"）
  const widePeak = maxBarIndex(bars1)
  const wideLen = bars1.length
  project.updateVisualizer({ freqMax: 4000 })
  await sleep(250)
  pbRef.current.seek(0.45)
  await sleep(300)
  pbRef.current.seek(0.45)
  await sleep(300)
  const bars3 = pbRef.current.bars.slice()
  const narrowPeak = maxBarIndex(bars3)
  if (bars3.length === wideLen && narrowPeak > widePeak + 3) {
    pass(
      '频率范围可调',
      '30–8k 440Hz 峰值 #' +
        widePeak +
        ' → 30–4k 峰值 #' +
        narrowPeak +
        '（柱数 ' +
        bars3.length +
        ' 不变）'
    )
  } else {
    fail(
      '频率范围可调',
      '柱数 ' + bars3.length + '（期望 ' + wideLen + '），峰值 #' + widePeak + ' → #' + narrowPeak
    )
  }
  project.updateVisualizer({ freqMax: 8000 })
  await sleep(250)

  // 形态可选（0.4.0）：切 flow 后可视化区像素布局改变（流动光带生效）且柱数组长度不变
  const barsBeforeStyle = pbRef.current.bars.slice()
  project.updateVisualizer({ style: 'flow' })
  await sleep(300)
  const capFlow = captureRegion(stage, vizX0, vizY0, vizX1, vizY1)
  const barsFlow = pbRef.current.bars.slice()
  const diffStyle = barsBeforeStyle.length === barsFlow.length ? countDiffPixels(cap1, capFlow) : -1
  if (diffStyle > 50 && barsFlow.length === wideLen) {
    pass('形态可选', 'flow 像素差异 ' + diffStyle + '（柱数不变）')
  } else {
    fail('形态可选', '像素差异=' + diffStyle + ' 柱数=' + barsFlow.length)
  }
  project.updateVisualizer({ style: 'bars' })
  await sleep(250)

  // 播放中折线动态（0.4.0 回归）：wave 播放中 p1/p2 两时刻可视化区应随频谱变化。
  // 等待 currentTime 前进（AudioContext resume 慢则频谱未动）确保采样点在音频播发中。
  project.updateVisualizer({ style: 'wave' })
  await sleep(300)
  pbRef.current.seek(0.2)
  pbRef.current.play()
  const wBoot = Date.now()
  while (pbRef.current.currentTime < 0.35 && Date.now() - wBoot < 3000) {
    await sleep(120)
    if (!pbRef.current.isPlaying && pbRef.current.currentTime < 0.1) {
      pbRef.current.seek(0.2)
      pbRef.current.play()
    }
  }
  const capW1 = captureRegion(stage, vizX0, vizY0, vizX1, vizY1)
  // 等待跨过 440→1200Hz 段切换点（音频前 1/2=440Hz 稳态段在 0.2–0.35s 波形几乎不变，
  // 需采样到 1.0s 之后的 1200Hz 段才能证明"波形随时间更新"）
  await sleep(1000)
  const capW2 = captureRegion(stage, vizX0, vizY0, vizX1, vizY1)
  pbRef.current.pause()
  const diffW = countDiffPixels(capW1, capW2)
  if (diffW > 100) {
    pass('播放中折线更新', 'wave 两时刻差异像素 ' + diffW)
  } else {
    fail('播放中折线更新', '两时刻像素差异=' + diffW + '（>100 预期）')
  }
  project.updateVisualizer({ style: 'bars' })
  await sleep(250)

  // 播放中 flow 频谱本体更新（0.4.0 回归）：flow 折线几何必须跟随时变频谱。
  // 曾因 frame(t) 通道重绘时使用冻结的 React bars 状态 → 绘制的包络停在旧谱，
  // 视觉上"只有细波在流动、频谱本体不动"。从节点 points() 直接读包络峰值柱位验证。
  project.updateVisualizer({ style: 'flow' })
  await sleep(300)
  const flowPeakColumn = (): number => {
    const nodes = stage.find('.viz-line')
    if (!nodes.length) return -1
    const pts = (nodes[0] as Konva.Line).points()
    let best = -1
    let bestH = -Infinity
    for (let i = 0; i + 1 < pts.length; i += 2) {
      const h = -pts[i + 1] // y 越小越高（同坐标系，峰值柱=最高点）
      if (h > bestH) {
        bestH = h
        best = i / 2
      }
    }
    return best
  }
  pbRef.current.seek(0.2)
  pbRef.current.play()
  // 直接轮询"绘制的包络"（不依赖 React currentTime state，躲避 resume 延迟期的假 0.2s）：
  // A：等待 440Hz 包络峰值柱（#61±6）出现（暂停态 seek 或播放中都算，内容一致）；
  // B：等待包络峰值移动到 1200Hz 段（>A+3 → 频谱本体随播放推进/拖动）。
  let flowPeakA = -1
  const fA0 = Date.now()
  while (Date.now() - fA0 < 6000 && flowPeakA < 0) {
    await sleep(150)
    const p = flowPeakColumn()
    if (p >= 55 && p <= 67) flowPeakA = p
  }
  let flowPeakB = -1
  let flowPeakBSeen = -1
  const fB0 = Date.now()
  while (Date.now() - fB0 < 10000) {
    await sleep(200)
    flowPeakB = flowPeakColumn()
    if (flowPeakB > flowPeakA + 3) {
      flowPeakBSeen = flowPeakB
      break
    }
  }
  pbRef.current.pause()
  const flowLines = stage.find('.viz-line').length
  if (flowPeakA >= 0 && flowPeakBSeen > flowPeakA + 3) {
    pass(
      '播放中 flow 频谱更新',
      '包络峰值柱 #' + flowPeakA + ' → #' + flowPeakBSeen + '（440→1200Hz 段）'
    )
  } else {
    fail(
      '播放中 flow 频谱更新',
      '峰值柱 #' +
        flowPeakA +
        ' → #' +
        flowPeakB +
        '（线节点 ' +
        flowLines +
        '；预期包络峰值右移 >3：播放推进后频谱本体未更新）'
    )
  }
  project.updateVisualizer({ style: 'bars' })
  await sleep(250)

  // 回归：播放中 seek 不得被旧音源 onended 误判为播完（曾跳到结尾并停止）
  pbRef.current.seek(0.2)
  pbRef.current.play()
  // 起播等待：AudioContext resume 偶发延迟 0.5–2s；条件轮询直到"正在播放且时间前进"（最多 2.5s），
  // 期间若掉出播放态则重试一次播放
  let bootOk = false
  const bootStart = Date.now()
  while (Date.now() - bootStart < 6000) {
    await sleep(120)
    const pbNow = pbRef.current
    if (pbNow.isPlaying && pbNow.currentTime > 0.01) {
      bootOk = true
      break
    }
    if (!pbNow.isPlaying && pbNow.currentTime < 0.15) {
      pbNow.seek(0.2)
      pbNow.play()
    }
  }
  const tBeforeSeek = pbRef.current.currentTime
  if (bootOk) {
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
  } else {
    pbRef.current.pause()
    fail('播放中 seek 不中断', '音频起播失败（AudioContext resume 超时）')
  }

  return { ok: checks.every((c) => c.pass), checks }
}

/* ================= 应用 ================= */

function App(): React.JSX.Element {
  const { t } = useLocale()
  const project = useProject()
  const [selectedId, setSelectedId] = useState<SelectableId>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const stageRef = useRef<Konva.Stage | null>(null)
  const projectRef = useRef(project)

  useEffect(() => {
    projectRef.current = project
  }, [project])
  const barsHandleRef = useRef<((bars: number[]) => void) | null>(null)
  const frameTRef = useRef<((t: number) => void) | null>(null)
  const pb = useAudioPlayback(
    project.assets.audioFile,
    project.layout.visualizer,
    barsHandleRef,
    frameTRef
  )
  const pbRef = useRef<PlaybackApi>(pb)

  const ffmpeg = useFfmpegStatus()
  const ffmpegDl = useFfmpegDownload(() => void ffmpeg.refresh())
  const outputPathRef = useRef('')
  const exporter = useExporter({
    layout: project.layout,
    coverElement: project.assets.coverElement,
    analyzer: pb.analyzer,
    audioFile: project.assets.audioFile,
    durationMs: Math.round(pb.duration * 1000),
    defaultName: project.layout.texts.songTitle.text,
    ffmpegAvailable: ffmpeg.report?.effective.available === true,
    outputPathRef
  })
  const exporterRef = useRef(exporter)
  const exporterStateRef = useRef(exporter.state)

  useEffect(() => {
    pbRef.current = pb
    exporterRef.current = exporter
    exporterStateRef.current = exporter.state
  }, [pb, exporter])

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
    window.__getAssetDebug = () => {
      const ce = projectRef.current.assets.coverElement
      const st = stageRef.current
      const mainLayer = st ? st.getLayers()[1] : null
      return {
        coverFile: projectRef.current.assets.coverFile?.name ?? null,
        coverUrl: projectRef.current.assets.coverUrl,
        coverElement: ce != null,
        naturalSize: ce ? ce.naturalWidth + 'x' + ce.naturalHeight : null,
        mainImageNodes: mainLayer ? mainLayer.find('Image').length : -1,
        fillMode: projectRef.current.layout.mainImage.fillMode,
        mainRect: JSON.stringify(projectRef.current.layout.mainImage.rect)
      }
    }
    window.__runAudioSmoke = () =>
      stageRef.current
        ? runAudioSmoke(project, pbRef, stageRef.current)
        : Promise.resolve({ ok: false, checks: [] })
    window.__runEncodeBenchmark = () => benchmarkEncoder(1920, 1080)
    return () => {
      delete window.__captureStage
      delete window.__runVisualChecks
      delete window.__runAudioSmoke
      delete window.__runEncodeBenchmark
      delete window.__getAssetDebug
    }
    // 仅无头自测模式生效，project 引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 全局撤销/重做快捷键（输入框内保留原生行为）+ 关闭前未保存确认接口
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null
      const typing =
        !!target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      if (typing) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) projectRef.current.redo()
        else projectRef.current.undo()
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        projectRef.current.redo()
      }
    }
    window.addEventListener('keydown', onKey)
    window.__isDirty = () => projectRef.current.dirty
    window.__saveAndClose = async () => {
      const ok = await projectRef.current.saveProject()
      return ok && !projectRef.current.dirty
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      delete window.__isDirty
      delete window.__saveAndClose
    }
  }, [])

  // 导出自测（M4/T21）：真实 File → 解码 → WebCodecs 编码 → ffmpeg 合并，落盘 TEST-ARTIFACTS
  useEffect(() => {
    if (!IS_SMOKE_EXPORT) return
    window.__runExportSmoke = async (resolutions: string[], durationSec: number) => {
      const results: {
        resolution: string
        phase: string
        seconds: number
        error: string | null
        message: string
      }[] = []
      const cover = await makeSyntheticCoverFile()
      if (cover) project.setCoverFile(cover)
      project.setAudioFile(makeTwoToneWavFile(durationSec, 44100))
      const t0 = Date.now()
      while (pbRef.current.status !== 'ready' && Date.now() - t0 < 15000) {
        await sleep(150)
      }
      if (pbRef.current.status !== 'ready') {
        return {
          ok: false,
          results: [
            {
              resolution: 'audio',
              phase: pbRef.current.status,
              seconds: 0,
              error: pbRef.current.error,
              message: ''
            }
          ]
        }
      }
      for (const rid of resolutions) {
        project.updateText('songTitle', { text: 'smoke-' + rid })
        project.updateExport({ resolutionId: rid, fps: 30 })
        await sleep(400)
        exporterRef.current.reset()
        // 等状态真正回到 idle（React 异步更新，否则读到上一轮的 done）
        const idleStart = Date.now()
        while (exporterStateRef.current.phase !== 'idle' && Date.now() - idleStart < 5000) {
          await sleep(100)
        }
        const started = performance.now()
        await exporterRef.current.start()
        const pollStart = Date.now()
        let phase = exporterStateRef.current.phase
        while (
          phase !== 'done' &&
          phase !== 'error' &&
          phase !== 'cancelled' &&
          Date.now() - pollStart < 900000
        ) {
          await sleep(500)
          phase = exporterStateRef.current.phase
        }
        const st = exporterStateRef.current
        results.push({
          resolution: rid,
          phase: st.phase,
          seconds: Math.round((performance.now() - started) / 100) / 10,
          error: st.error,
          message: st.encodeInfo ?? st.message
        })
        if (st.phase !== 'done') break
      }
      return { ok: results.every((r) => r.phase === 'done'), results }
    }

    return () => {
      delete window.__runExportSmoke
    }
    // 仅无头自测模式生效
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 项目保存/加载自测（M5/T25）：保存 → 篡改 → 加载 → 对比
  useEffect(() => {
    if (!IS_SMOKE_PROJECT) return
    window.__runProjectSmoke = async () => {
      const checks: VisualCheckItem[] = []
      const add = (label: string, pass: boolean, detail: string): void => {
        checks.push({ label, pass, detail })
      }
      const cover = await makeSyntheticCoverFile()
      if (cover) project.setCoverFile(cover)
      const wav = makeTwoToneWavFile(3, 44100)
      project.setAudioFile(wav)
      const t0 = Date.now()
      while (pbRef.current.status !== 'ready' && Date.now() - t0 < 15000) {
        await sleep(150)
      }
      if (pbRef.current.status !== 'ready') {
        return {
          ok: false,
          checks: [{ label: '音频就绪', pass: false, detail: pbRef.current.status }]
        }
      }
      add('音频就绪', true, '时长 ' + pbRef.current.duration.toFixed(2) + 's')
      project.updateText('songTitle', { text: '项目测试曲' })
      project.updateVisualizer({ barCount: 140 })
      project.updateBackground({ blur: 40 })
      // 独立背景图（用户反馈：背景可额外上传图，默认用封面）
      const bgF = await makeSyntheticCoverFile()
      if (bgF) project.setBgFile(bgF)
      await sleep(300)
      // 先走真实保存路径（更新已保存快照，同步 dirty 状态）
      await project.saveProject()
      // 再用带音频磁盘路径的版本覆盖磁盘文件（smoke 音频是内存生成，需落盘路径）
      const pf = await project.buildProjectFile()
      const audioPath = await window.api.exportApi.saveAudio(
        await wav.arrayBuffer(),
        'smoke-audio.wav'
      )
      pf.audio = { name: 'smoke-audio.wav', path: audioPath }
      const saveRes = await window.api.project.save(JSON.stringify(pf, null, 2), 'smoke-project')
      add('保存项目', saveRes.ok, saveRes.ok ? '已写入 ' + saveRes.path : '保存失败')
      add('保存后未脏', !projectRef.current.dirty, 'dirty=' + projectRef.current.dirty)
      project.updateText('songTitle', { text: '已修改' })
      project.updateVisualizer({ barCount: 100 })
      project.updateBackground({ blur: 0 })
      project.clearBgImage()
      // 撤销/重做（用户反馈：画布操作可 Ctrl+Z；篡改区共 4 个历史条目（文本/柱数/模糊/背景图来源））
      await sleep(200)
      project.undo()
      await sleep(120)
      project.undo()
      await sleep(120)
      project.undo()
      await sleep(120)
      project.undo()
      await sleep(200)
      const ul = projectRef.current.layout
      add(
        '撤销',
        ul.texts.songTitle.text === '项目测试曲' &&
          ul.visualizer.barCount === 140 &&
          ul.background.blur === 40,
        'undo×4 后: 歌名=' +
          ul.texts.songTitle.text +
          ' 柱数=' +
          ul.visualizer.barCount +
          ' 模糊=' +
          ul.background.blur
      )
      project.redo()
      await sleep(120)
      project.redo()
      await sleep(120)
      project.redo()
      await sleep(120)
      project.redo()
      await sleep(200)
      const rl = projectRef.current.layout
      add(
        '重做',
        rl.texts.songTitle.text === '已修改' &&
          rl.visualizer.barCount === 100 &&
          rl.background.blur === 0,
        'redo×4 后: 歌名=' +
          rl.texts.songTitle.text +
          ' 柱数=' +
          rl.visualizer.barCount +
          ' 模糊=' +
          rl.background.blur
      )
      await sleep(300)
      await project.loadProject()
      const waitStart = Date.now()
      while (Date.now() - waitStart < 8000) {
        const l = projectRef.current.layout
        if (l.texts.songTitle.text === '项目测试曲' && l.visualizer.barCount === 140) break
        await sleep(150)
      }
      const l = projectRef.current.layout
      const restored =
        l.texts.songTitle.text === '项目测试曲' &&
        l.visualizer.barCount === 140 &&
        l.background.blur === 40
      add(
        '布局恢复',
        restored,
        '歌名=' +
          l.texts.songTitle.text +
          ' 柱数=' +
          l.visualizer.barCount +
          ' 模糊=' +
          l.background.blur
      )
      // 独立背景图恢复
      const bgWait = Date.now()
      while (!projectRef.current.assets.bgElement && Date.now() - bgWait < 5000) {
        await sleep(150)
      }
      const ba = projectRef.current.assets
      add(
        '背景图恢复',
        ba.bgUrl != null &&
          ba.bgElement != null &&
          projectRef.current.layout.background.imageSource === 'custom',
        'bgUrl=' +
          (ba.bgUrl != null) +
          ' bgElement=' +
          (ba.bgElement != null) +
          ' source=' +
          projectRef.current.layout.background.imageSource
      )
      // 封面走 dataURL → Image 异步解码，等待就绪
      const coverWait = Date.now()
      while (!projectRef.current.assets.coverElement && Date.now() - coverWait < 5000) {
        await sleep(150)
      }
      const a = projectRef.current.assets
      add('封面恢复', a.coverElement != null, a.coverElement ? '封面已恢复' : '封面缺失')
      const audioWait = Date.now()
      while (pbRef.current.status !== 'ready' && Date.now() - audioWait < 15000) {
        await sleep(150)
      }
      add(
        '音频恢复',
        pbRef.current.status === 'ready' && Math.abs(pbRef.current.duration - 3) < 0.5,
        'status=' + pbRef.current.status + ' 时长=' + pbRef.current.duration.toFixed(2) + 's'
      )
      // 新建项目：应回到默认布局并清空素材
      project.resetProject()
      // 竞态防护：轮询等待 reset 的异步提交完成（曾偶发读到旧状态）
      const resetWait = Date.now()
      let nl = projectRef.current.layout
      let na = projectRef.current.assets
      while (
        (nl.texts.songTitle.text !== '歌曲名' || na.audioFile != null) &&
        Date.now() - resetWait < 3000
      ) {
        await sleep(120)
        nl = projectRef.current.layout
        na = projectRef.current.assets
      }
      add(
        '新建重置',
        nl.texts.songTitle.text === '歌曲名' &&
          na.coverUrl == null &&
          na.audioFile == null &&
          na.bgUrl == null,
        '歌名=' +
          nl.texts.songTitle.text +
          ' 封面=' +
          (na.coverUrl != null) +
          ' 音频=' +
          (na.audioFile?.name ?? 'null')
      )
      add('新建后未脏', !projectRef.current.dirty, 'dirty=' + projectRef.current.dirty)
      // 关闭守卫关键路径：保存后脏标记必须是 false（曾因 hasBg 字段漂移恒为 true）
      return { ok: checks.every((c) => c.pass), checks }
    }
    return () => {
      delete window.__runProjectSmoke
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">NikoKaraokeVideoMaker</h1>
        <div className="header-actions">
          <button
            type="button"
            className="mini-btn"
            disabled={!project.canUndo}
            title={t('header.undoTitle')}
            onClick={project.undo}
          >
            {t('header.undo')}
          </button>
          <button
            type="button"
            className="mini-btn"
            disabled={!project.canRedo}
            title={t('header.redoTitle')}
            onClick={project.redo}
          >
            {t('header.redo')}
          </button>
          <button type="button" className="mini-btn" onClick={() => void project.saveProject()}>
            {t('header.saveProject')}
          </button>
          <button
            type="button"
            className="mini-btn"
            onClick={() => {
              if (window.confirm(t('header.newProjectConfirm'))) {
                project.resetProject()
                setSelectedId(null)
              }
            }}
          >
            {t('header.newProject')}
          </button>
          <button type="button" className="mini-btn" onClick={() => void project.loadProject()}>
            {t('header.openProject')}
          </button>
          <button type="button" className="mini-btn" onClick={() => setExportOpen(true)}>
            {t('header.export')}
          </button>
          <button type="button" className="mini-btn" onClick={() => setHelpOpen(true)}>
            {t('header.help')}
          </button>
          <button type="button" className="mini-btn" onClick={() => setSettingsOpen(true)}>
            {t('header.settings')}
          </button>
        </div>
      </header>
      {!ffmpeg.loading && ffmpeg.report && !ffmpeg.report.effective.available && (
        <div className="ffmpeg-banner">
          <span>{t('banner.noFfmpeg')}</span>
          <button type="button" className="banner-btn" onClick={() => void ffmpegDl.start()}>
            {t('banner.downloadTool')}
          </button>
          <button
            type="button"
            className="banner-btn"
            onClick={() => {
              void (async () => {
                const p = await window.api.ffmpeg.pickCustom()
                if (p) {
                  await window.api.ffmpeg.setConfig({ customPath: p, source: 'custom' })
                  await ffmpeg.refresh()
                }
              })()
            }}
          >
            {t('banner.specifyTool')}
          </button>
        </div>
      )}
      {project.notice && (
        <div className="notice-bar">
          <span>{project.notice}</span>
          <button type="button" className="mini-btn" onClick={project.clearNotice}>
            ✕
          </button>
        </div>
      )}
      {ffmpegDl.state && ffmpegDl.state.phase !== 'done' && (
        <div className="ffmpeg-banner">
          <span>
            {ffmpegDl.state.message}
            {ffmpegDl.state.percent != null ? ' ' + ffmpegDl.state.percent + '%' : ''}
          </span>
          <button type="button" className="banner-btn" onClick={ffmpegDl.cancel}>
            {t('banner.cancelDownload')}
          </button>
        </div>
      )}
      <div className="app-body">
        <SidePanel
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
          audioStatus={pb.status}
          audioError={pb.error}
          duration={pb.duration}
          currentTime={pb.currentTime}
          isPlaying={pb.isPlaying}
          audioFileName={project.assets.audioFile?.name ?? null}
          onPlay={pb.play}
          onPause={pb.pause}
          onSeek={pb.seek}
          mainImage={project.layout.mainImage}
          onMainImageChange={project.updateMainImage}
          background={project.layout.background}
          bgUrl={project.assets.bgUrl}
          bgFile={project.assets.bgFile}
          onBackgroundChange={project.updateBackground}
          onBgFile={(f) => void project.setBgFile(f)}
          onClearBg={project.clearBgImage}
          songTitleCfg={project.layout.texts.songTitle}
          artistCfg={project.layout.texts.artist}
          onSongTitleCfgChange={(x) => project.updateText('songTitle', x)}
          onArtistCfgChange={(x) => project.updateText('artist', x)}
          visualizer={project.layout.visualizer}
          onVisualizerChange={project.updateVisualizer}
        />
        <main className="canvas-wrap">
          <CanvasStage
            layout={project.layout}
            coverElement={project.assets.coverElement}
            bgElement={project.assets.bgElement}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMainRectChange={project.updateMainRect}
            onTextRectChange={(kind, rect) => project.updateText(kind, { rect })}
            onVisualizerRectChange={(rect) => project.updateVisualizer({ rect })}
            bars={pb.bars}
            barsHandleRef={barsHandleRef}
            frameTRef={frameTRef}
            onStageReady={(s) => {
              stageRef.current = s
            }}
          />
          {subzoneWarning && <div className="warn-banner">{t('canvas.subtitleZoneWarn')}</div>}
        </main>
      </div>
      <HelpDialog open={helpOpen} onClose={() => setHelpOpen(false)} />
      <ExportDialog
        open={exportOpen}
        onClose={() => {
          setExportOpen(false)
          if (
            exporter.state.phase !== 'preparing' &&
            exporter.state.phase !== 'encoding' &&
            exporter.state.phase !== 'merging'
          ) {
            exporter.reset()
          }
        }}
        config={project.layout.export}
        onChange={project.updateExport}
        state={exporter.state}
        ffmpegAvailable={ffmpeg.report?.effective.available === true}
        audioReady={pb.status === 'ready'}
        onExport={() => void exporter.start()}
        onCancel={exporter.cancel}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        status={ffmpeg.report}
        loading={ffmpeg.loading}
        onRefresh={() => void ffmpeg.refresh()}
      />
      {exporter.stageRequest && (
        <ExportStageHost
          layout={project.layout}
          coverElement={project.assets.coverElement}
          bgElement={project.assets.bgElement}
          width={exporter.stageRequest.width}
          height={exporter.stageRequest.height}
          onReady={exporter.onStageReady}
        />
      )}
    </div>
  )
}

export default App
