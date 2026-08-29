import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { SUBTITLE_ZONE_Y } from '@shared/layout'
import { useLocale } from './hooks/useLocale'
import { useProject } from './hooks/useProject'
import { useAudioPlayback, type PlaybackApi } from './hooks/useAudioPlayback'
import { useFfmpegDownload, useFfmpegStatus } from './hooks/useFfmpeg'
import { useExporter } from './hooks/useExporter'
import { benchmarkEncoder } from './export/exportVideo'
import { drawCanvasFx } from '@shared/canvasfx'
import { drawParticles, particlesAt } from '@shared/particles'
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

/** 大图封面（4000×3000 渐变，模拟手机照片）：图片导入性能探针用 */
function makeBigCoverFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const c = document.createElement('canvas')
    c.width = 4000
    c.height = 3000
    const ctx = c.getContext('2d')
    if (!ctx) {
      resolve(null)
      return
    }
    const g = ctx.createLinearGradient(0, 0, 4000, 3000)
    g.addColorStop(0, '#ff5f9e')
    g.addColorStop(1, '#7c3aed')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4000, 3000)
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.arc(2000, 1500, 900, 0, Math.PI * 2)
    ctx.fill()
    c.toBlob((blob) => {
      resolve(blob ? new File([blob], 'big-cover-4000x3000.png', { type: 'image/png' }) : null)
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
  stage: Konva.Stage,
  projectRefArg: React.RefObject<ReturnType<typeof useProject>>
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
  // 阈值 >100：ffmpeg 解码路径（44.1kHz 上采样自 8kHz 源）与旧 WebAudio 管线柱形略异，差异 ~130
  if (diffPx > 100) {
    pass('可视化动态渲染', '两时刻频谱区域差异像素 ' + diffPx + ' 个')
  } else {
    fail('可视化动态渲染', '两时刻频谱区域仅 ' + diffPx + ' 个差异像素（预期 >100）')
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
  // 全部基于"绘制的包络"轮询（不依赖 currentTime state：本环境其更新滞后/不可靠，
  // 曾导致假 0.2s 与静默重启）。AudioContext resume 偶发 6–15s，预算放宽到 25s。
  // A：等待 440Hz 包络峰值柱（#61±6）——seek 后立即绘制，起播前/后内容一致；
  // B：等待包络峰值移动到 1200Hz 段（>A+3）= 频谱本体随时间轴真实推进。
  let flowPeakA = -1
  const fA0 = Date.now()
  while (Date.now() - fA0 < 6000 && flowPeakA < 0) {
    await sleep(150)
    const p = flowPeakColumn()
    if (p >= 55 && p <= 67) flowPeakA = p
  }
  let flowPeakB = -1
  let flowPeakBSeen = -1
  let retried = false
  const fB0 = Date.now()
  while (Date.now() - fB0 < 30000) {
    await sleep(250)
    flowPeakB = flowPeakColumn()
    if (flowPeakB > flowPeakA + 3) {
      flowPeakBSeen = flowPeakB
      break
    }
    // AudioContext resume 偶发假起（isPlaying=true 但时钟不动）：6s 未推进则重启一次
    if (!retried && Date.now() - fB0 > 6000) {
      retried = true
      pbRef.current.pause()
      pbRef.current.seek(0.2)
      pbRef.current.play()
    }
  }
  pbRef.current.pause()
  // 诊断（仅失败时用）：暂停态 seek 到 1200Hz 段（state 路径 + 重绘 effect），
  // 若 pause-seek 也画不出 #84 → 绘制/读取链路问题；否则=播放时钟未推进（环境 resume 卡滞）。
  pbRef.current.seek(1.45)
  await sleep(400)
  const diagPeak = flowPeakColumn()
  const diagTime = pbRef.current.currentTime
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
        '，诊断 pause-seek1.45=' +
        diagPeak +
        ' t=' +
        diagTime.toFixed(2) +
        '；预期包络峰值右移 >3）'
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

  // ── 0.5.0 动效回归（暂停态 seek 驱动：确定性、无 AudioContext 时序依赖）──
  const countBright = (data: Uint8ClampedArray): number => {
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i] > 180 && data[i + 1] > 170 && data[i + 2] > 170) n++
    }
    return n
  }
  const meanSum = (data: Uint8ClampedArray): number => {
    let s = 0
    const n = Math.max(1, data.length / 4)
    for (let i = 0; i < data.length; i += 4) s += data[i] + data[i + 1] + data[i + 2]
    return s / n
  }

  // Ken Burns：背景区两时刻（0.4s→1.8s）像素差异（测试音频 2s：seek 钳制在 2s 内；周期 3s 便于观察）
  project.updateBackgroundFx({ kenBurns: 0.35, kenBurnsDuration: 3 })
  await sleep(200)
  pbRef.current.seek(0.4)
  await sleep(250)
  const kbA = captureRegion(stage, 0.05 * 1920, 0.62 * 1080, 0.4 * 1920, 0.95 * 1080)
  pbRef.current.seek(1.8)
  await sleep(250)
  const kbB = captureRegion(stage, 0.05 * 1920, 0.62 * 1080, 0.4 * 1920, 0.95 * 1080)
  project.updateBackgroundFx({ kenBurns: 0 })
  const kbDiff = countDiffPixels(kbA, kbB)
  if (kbDiff > 80) {
    pass('Ken Burns 生效', '背景区两时刻差异像素 ' + kbDiff)
  } else {
    fail('Ken Burns 生效', '背景区两时刻差异 ' + kbDiff + '（>80 预期）')
  }

  // 全局后期（暗角）：离屏 canvas 直接绘制管线（预览 overlay / 导出 compose 同函数，
  // 舞台 toCanvas 不含 DOM 叠加层，故用同一函数离屏验证）
  const off = document.createElement('canvas')
  off.width = 320
  off.height = 180
  const octx = off.getContext('2d')
  if (octx) {
    octx.fillStyle = '#ffffff'
    octx.fillRect(0, 0, 320, 180)
    drawCanvasFx(
      octx,
      { t: 1.0, vignette: 0.85, grain: 0, scanline: 0, beatFlash: 0, lightLeak: 0 },
      320,
      180
    )
    const corner = octx.getImageData(10, 10, 1, 1).data
    const center = octx.getImageData(160, 90, 1, 1).data
    if (corner[0] < center[0] - 80) {
      pass('全局后期（暗角）', '角 r=' + corner[0] + ' 暗于中心 r=' + center[0])
    } else {
      fail('全局后期（暗角）', '角 r=' + corner[0] + ' 中心 r=' + center[0] + '（预期角暗 >80）')
    }
    // 颗粒确定性：同 t 同输出；t 推进输出变化
    octx.fillStyle = '#808080'
    octx.fillRect(0, 0, 320, 180)
    drawCanvasFx(
      octx,
      { t: 2.0, vignette: 0, grain: 0.5, scanline: 0, beatFlash: 0, lightLeak: 0 },
      320,
      180
    )
    const gA = octx.getImageData(0, 0, 320, 180).data.slice()
    octx.fillStyle = '#808080'
    octx.fillRect(0, 0, 320, 180)
    drawCanvasFx(
      octx,
      { t: 2.0, vignette: 0, grain: 0.5, scanline: 0, beatFlash: 0, lightLeak: 0 },
      320,
      180
    )
    const gB = octx.getImageData(0, 0, 320, 180).data.slice()
    if (countDiffPixels(gA, gB) === 0) {
      octx.fillStyle = '#808080'
      octx.fillRect(0, 0, 320, 180)
      drawCanvasFx(
        octx,
        { t: 2.0 + 1 / 24, vignette: 0, grain: 0.5, scanline: 0, beatFlash: 0, lightLeak: 0 },
        320,
        180
      )
      const gC = octx.getImageData(0, 0, 320, 180).data.slice()
      if (countDiffPixels(gB, gC) > 0) {
        pass('颗粒确定性', '同 t 完全一致；t 推进后颗粒移动')
      } else {
        fail('颗粒确定性', 't 推进后颗粒未移动（grainOffset 可能退化）')
      }
    } else {
      fail('颗粒确定性', '同 t 两次绘制不一致（种子退化）')
    }
  }

  // 片头黑场：t≈0 全黑 → t=1.5 正常画面（等待黑场叠色真的到位，防绘制调度抖动）
  project.updateIntroOutro({ introFade: 1 })
  await sleep(200)
  pbRef.current.seek(0.05)
  const blackWait = Date.now()
  await sleep(200)
  while (
    Date.now() - blackWait < 2000 &&
    stage.find('.fx-black').length &&
    stage.find('.fx-black')[0].opacity() < 0.9
  ) {
    await sleep(80)
    pbRef.current.seek(0.05)
  }
  const introA = captureRegion(stage, 0.3 * 1920, 0.3 * 1080, 0.7 * 1920, 0.7 * 1080)
  pbRef.current.seek(1.5)
  await sleep(250)
  const introB = captureRegion(stage, 0.3 * 1920, 0.3 * 1080, 0.7 * 1920, 0.7 * 1080)
  project.updateIntroOutro({ introFade: 0 })
  if (meanSum(introB) - meanSum(introA) > 120) {
    pass(
      '片头黑场',
      't=0.05 中心亮度 ' + meanSum(introA).toFixed(0) + ' → t=1.5 ' + meanSum(introB).toFixed(0)
    )
  } else {
    fail(
      '片头黑场',
      '亮度 ' + meanSum(introA).toFixed(0) + '→' + meanSum(introB).toFixed(0) + '（>120 预期）'
    )
  }

  // 文本打字机：t=0.3 字符亮度像素少于 t=2.0（完成后复位最终态且与 none 等值）
  project.updateTextEntry('songTitle', { type: 'typewriter', durationSec: 1.2, delaySec: 0 })
  await sleep(200)
  pbRef.current.seek(0.3)
  await sleep(250)
  const twA = captureRegion(stage, 0.54 * 1920, 0.13 * 1080, 0.94 * 1920, 0.25 * 1080)
  pbRef.current.seek(2.0)
  await sleep(250)
  const twB = captureRegion(stage, 0.54 * 1920, 0.13 * 1080, 0.94 * 1920, 0.25 * 1080)
  project.updateTextEntry('songTitle', { type: 'none' })
  if (countBright(twB) > countBright(twA) + 20) {
    pass('打字机入场', '亮像素 ' + countBright(twA) + ' → ' + countBright(twB))
  } else {
    fail('打字机入场', '亮像素 ' + countBright(twA) + '→' + countBright(twB) + '（+20 预期）')
  }

  // ── 0.6.0 音乐响应（手动节拍源：暂停态 seek 对齐 beat 网格，确定性）──
  // 手动节拍脉冲（Konva 层可捕获）：beat 起点（t≈0）背景亮度高于 beat 末段（t≈0.46）
  project.updateVisualizer({ bpm: 120 }) // 周期 0.5s
  project.updateBeatFx({ pulse: 1, burst: 0, particleDensity: 0 })
  await sleep(200)
  pbRef.current.seek(0.02)
  await sleep(250)
  // 纯背景区（右侧下方：避开主图/文本/合成封面的白色圆盘——白色底上白闪无对比；
  // 该区为模糊粉紫渐变，白色脉冲叠色对比明显）
  // 等待脉冲叠色真的到达 beat 起点值（≥0.3）再采样（防绘制调度抖动）
  const opWait = Date.now()
  await sleep(200)
  while (
    Date.now() - opWait < 2000 &&
    stage.find('.bg-pulse').length &&
    stage.find('.bg-pulse')[0].opacity() < 0.3
  ) {
    await sleep(80)
    pbRef.current.seek(0.02)
  }
  const beatA = captureRegion(stage, 0.8 * 1920, 0.6 * 1080, 0.96 * 1920, 0.94 * 1080)
  const opA = stage.find('.bg-pulse').length ? stage.find('.bg-pulse')[0].opacity() : -1
  pbRef.current.seek(0.46)
  await sleep(250)
  const beatB = captureRegion(stage, 0.8 * 1920, 0.6 * 1080, 0.96 * 1920, 0.94 * 1080)
  const opB = stage.find('.bg-pulse').length ? stage.find('.bg-pulse')[0].opacity() : -1
  if (meanSum(beatA) - meanSum(beatB) > 15) {
    pass(
      '手动节拍脉冲',
      'beat 起点背景亮度 ' +
        meanSum(beatA).toFixed(0) +
        ' > 末段 ' +
        meanSum(beatB).toFixed(0) +
        '（A op=' +
        opA.toFixed(2) +
        ' B op=' +
        opB.toFixed(2) +
        '）'
    )
  } else {
    fail(
      '手动节拍脉冲',
      '亮度 ' +
        meanSum(beatA).toFixed(0) +
        ' vs ' +
        meanSum(beatB).toFixed(0) +
        '（A op=' +
        opA.toFixed(2) +
        ' B op=' +
        opB.toFixed(2) +
        '）'
    )
  }

  // 粒子系统（离屏：粒子在 DOM overlay 层，stage.toCanvas 不可见 → 同函数离屏验证）
  const pcanvas = document.createElement('canvas')
  pcanvas.width = 320
  pcanvas.height = 180
  const pctx = pcanvas.getContext('2d')
  if (pctx) {
    pctx.clearRect(0, 0, 320, 180)
    drawParticles(pctx, particlesAt(0.05, 'snow', 0.9, 1, 320, 180))
    const snowN = countDiffPixels(
      pctx.getImageData(0, 0, 320, 180).data,
      new Uint8ClampedArray(320 * 180 * 4)
    )
    pctx.clearRect(0, 0, 320, 180)
    drawParticles(pctx, particlesAt(0.25, 'snow', 0.9, 1, 320, 180))
    const snowM = countDiffPixels(
      pctx.getImageData(0, 0, 320, 180).data,
      new Uint8ClampedArray(320 * 180 * 4)
    )
    pctx.clearRect(0, 0, 320, 180)
    drawParticles(pctx, particlesAt(0.05, 'snow', 0, 1, 320, 180))
    const snowOff = countDiffPixels(
      pctx.getImageData(0, 0, 320, 180).data,
      new Uint8ClampedArray(320 * 180 * 4)
    )
    if (snowN > 0 && snowM > 0 && snowOff === 0) {
      pass('粒子系统', '雪：t 推进像素 ' + snowN + '→' + snowM + '；密度 0 = 空')
    } else {
      fail('粒子系统', 'n=' + snowN + ' m=' + snowM + ' off=' + snowOff)
    }
    // 手动节拍源踩点闪光（离屏同函数）：beat 起点白闪，beat 中间无闪
    const fctx = pctx
    ;(fctx as CanvasRenderingContext2D).clearRect(0, 0, 320, 180)
    fctx.fillStyle = '#333333'
    fctx.fillRect(0, 0, 320, 180)
    drawCanvasFx(
      fctx,
      {
        t: 0.0,
        vignette: 0,
        grain: 0,
        scanline: 0,
        beatFlash: 1,
        lightLeak: 0,
        beatPeriodSec: 0.5
      },
      320,
      180
    )
    const flashOn = fctx.getImageData(160, 90, 1, 1).data[0]
    fctx.fillStyle = '#333333'
    fctx.fillRect(0, 0, 320, 180)
    drawCanvasFx(
      fctx,
      {
        t: 0.25,
        vignette: 0,
        grain: 0,
        scanline: 0,
        beatFlash: 1,
        lightLeak: 0,
        beatPeriodSec: 0.5
      },
      320,
      180
    )
    const flashOff = fctx.getImageData(160, 90, 1, 1).data[0]
    if (flashOn > flashOff + 60) {
      pass('踩点闪光（手动源）', 'beat 起点 r=' + flashOn + ' > 中间 r=' + flashOff)
    } else {
      fail('踩点闪光（手动源）', flashOn + ' vs ' + flashOff + '（>60 预期）')
    }
  }

  // 复位全部动效（防污染后续检查/导出）
  project.updateCanvasFx({ vignette: 0, grain: 0, scanline: 0, beatFlash: 0, lightLeak: 0 })
  project.updateIntroOutro({ introFade: 0, introTitleCard: 0, outroFade: 0 })
  project.updateBackgroundFx({ kenBurns: 0, bassBrightness: 0, bassHue: 0 })
  project.updateVisualizer({ bpm: null, beatIntervalSec: null })
  project.updateBeatFx({ pulse: 0, burst: 0, particleDensity: 0 })

  // ── 0.7.0 前导 WYSIWYG（预览与导出同时间轴：前奏黑场/标题卡 + 音乐延后 + 静音柱）──
  project.updateAudioEngine({ leadMs: 1500 })
  await sleep(250)
  // ① 前导段（时间轴 0–1.5s）：黑幕 opacity≈1、场景中心全黑、频谱为静音柱、时间轴总长=2+1.5
  //（重试等待同「片头黑场」：防绘制调度/布局提交抖动）
  let leadBlackOp = -1
  let leadBars: number[] = []
  const leadWait = Date.now()
  while (Date.now() - leadWait < 4000) {
    pbRef.current.seek(0.5)
    await sleep(200)
    leadBlackOp = stage.find('.fx-black').length ? stage.find('.fx-black')[0].opacity() : -1
    leadBars = pbRef.current.bars.slice()
    if (leadBlackOp >= 0.9 && !leadBars.some((v) => v > 0.02)) break
    await sleep(100)
  }
  const leadCap = captureRegion(stage, 0.3 * 1920, 0.3 * 1080, 0.7 * 1920, 0.7 * 1080)
  const leadBlack = meanSum(leadCap) < 30 && leadBlackOp >= 0.9 && !leadBars.some((v) => v > 0.02)
  if (
    leadBlack &&
    Math.abs(pbRef.current.currentTime - 0.5) < 0.05 &&
    Math.abs(pbRef.current.timelineDuration - 3.5) < 0.01
  ) {
    pass(
      '前导 WYSIWYG（黑场+静音柱）',
      't=0.5 亮度 ' +
        meanSum(leadCap).toFixed(0) +
        '（黑幕 op=' +
        leadBlackOp.toFixed(2) +
        '），柱全 0，时间轴 ' +
        pbRef.current.timelineDuration.toFixed(2) +
        's = 音频 2s + 前导 1.5s'
    )
  } else {
    fail(
      '前导 WYSIWYG（黑场+静音柱）',
      '亮度=' +
        meanSum(leadCap).toFixed(0) +
        ' 黑幕op=' +
        leadBlackOp.toFixed(2) +
        ' 柱峰值=' +
        Math.max(...leadBars, 0).toFixed(2) +
        ' 时间轴=' +
        pbRef.current.timelineDuration.toFixed(2) +
        ' layout.leadMs=' +
        project.layout.audio.leadMs
    )
  }
  // ② 跨过前导（时间轴 1.95s = 音频 0.45s）：音乐起、440Hz 段频谱恢复、画面亮起
  pbRef.current.seek(1.95)
  await sleep(300)
  const postBars = pbRef.current.bars.slice()
  const postCap = captureRegion(stage, 0.3 * 1920, 0.3 * 1080, 0.7 * 1920, 0.7 * 1080)
  if (postBars.some((v) => v > 0.05) && meanSum(postCap) > 40) {
    pass(
      '前导后音乐起（频谱恢复）',
      't=1.95（音频 0.45s）柱峰值 ' +
        Math.max(...postBars).toFixed(2) +
        '，中心亮度 ' +
        meanSum(postCap).toFixed(0)
    )
  } else {
    fail(
      '前导后音乐起（频谱恢复）',
      '柱峰值=' + Math.max(...postBars, 0).toFixed(2) + ' 亮度=' + meanSum(postCap).toFixed(0)
    )
  }
  project.updateAudioEngine({ leadMs: 0 })
  await sleep(250)
  pbRef.current.seek(0.45)
  await sleep(200)

  // 长音频导入性能探针（用户反馈：导入后长时间卡顿）：180s WAV → 解码耗时。
  // 注意：必须等 status 先进入 loading（否则读到就绪旧状态直接跳过）
  const pbStatus = (): string => pbRef.current.status
  const waitLoadingThenReady = async (timeoutMs: number): Promise<{ st: string; ms: number }> => {
    const t0 = Date.now()
    let st = pbStatus()
    while (st === 'ready' && Date.now() - t0 < timeoutMs) {
      await sleep(30)
      st = pbStatus()
    }
    while ((st === 'loading' || st === 'empty') && Date.now() - t0 < timeoutMs) {
      await sleep(80)
      st = pbStatus()
    }
    return { st, ms: Date.now() - t0 }
  }
  project.setAudioFile(makeTwoToneWavFile(180, 8000))
  const longRes = await waitLoadingThenReady(30000)
  const decodeMs = longRes.ms
  if (longRes.st === 'ready') {
    pass(
      '长音频导入耗时',
      decodeMs + 'ms（180s WAV 解码至就绪，时长 ' + pbRef.current.duration.toFixed(0) + 's）'
    )
  } else {
    fail('长音频导入耗时', 'status=' + longRes.st + ' 等待 ' + decodeMs + 'ms')
  }

  // 真实音频导入探针（NIKO_AUDIO_PROBE=路径，经 IPC 读字节）：用户提供的长音频走真实导入路径计时。
  // 附带堆采样（performance.memory）：验证解码期 V8 堆不再飙升到数 GB（曾 OOM 4058MB）。
  const probePath = (window as unknown as { __NIKO_PROBE_AUDIO_PATH?: string })
    .__NIKO_PROBE_AUDIO_PATH
  if (probePath) {
    const probeBytes = await window.api.project.readBytes(probePath)
    const name = probePath.split(/[\\/]/).pop() ?? 'probe'
    const heapNow = (): number => {
      const m = (performance as unknown as { memory?: { usedJSHeapSize?: number } }).memory
      return m?.usedJSHeapSize ?? 0
    }
    let heapMax = heapNow()
    // 主线程停顿探针：UI 卡死 = 事件循环长时间无空闲（间隔 = 被占用的时长）
    let lastTick = performance.now()
    let maxGap = 0
    const heapTimer = setInterval(() => {
      heapMax = Math.max(heapMax, heapNow())
      const now = performance.now()
      maxGap = Math.max(maxGap, now - lastTick)
      lastTick = now
    }, 200)
    project.setAudioFile(
      new File([probeBytes as Uint8Array<ArrayBuffer>], name, { type: 'audio/mpeg' })
    )
    const res = await waitLoadingThenReady(90000)
    clearInterval(heapTimer)
    const ms = res.ms
    if (res.st === 'ready') {
      pass(
        '真实音频导入耗时',
        ms +
          'ms（' +
          (probeBytes.length / 1048576).toFixed(1) +
          'MB ' +
          name +
          ' → 就绪，时长 ' +
          pbRef.current.duration.toFixed(0) +
          's，堆峰值 ' +
          (heapMax / 1048576).toFixed(0) +
          'MB，主线程最大停顿 ' +
          maxGap.toFixed(0) +
          'ms）'
      )
    } else {
      fail(
        '真实音频导入耗时',
        'status=' +
          res.st +
          ' 等待 ' +
          ms +
          'ms，堆峰值 ' +
          (heapMax / 1048576).toFixed(0) +
          'MB，主线程最大停顿 ' +
          maxGap.toFixed(0) +
          'ms'
      )
    }
  }

  // 图片导入性能探针（用户反馈：导入大图卡顿）：4000×3000 封面 → 就绪耗时
  // 注意：轮询必须走 projectRef.current（闭包里的 project 是调用时的旧对象，看不到资产更新）
  const bigCover = await makeBigCoverFile()
  if (bigCover) {
    const imgT0 = Date.now()
    project.setCoverFile(bigCover)
    // 先等 coverFile 换成大图（避免用旧封面残留过早退出），再等 coverElement 就绪
    let cf = projectRefArg.current.assets.coverFile
    while (cf?.name !== 'big-cover-4000x3000.png' && Date.now() - imgT0 < 30000) {
      await sleep(60)
      cf = projectRefArg.current.assets.coverFile
    }
    let el = projectRefArg.current.assets.coverElement
    while (el == null && Date.now() - imgT0 < 30000) {
      await sleep(60)
      el = projectRefArg.current.assets.coverElement
    }
    const imgMs = Date.now() - imgT0
    const nat = el
      ? ((el as HTMLImageElement).naturalWidth || el.width) +
        'x' +
        ((el as HTMLImageElement).naturalHeight || el.height)
      : '-'
    if (el) {
      pass('大图导入耗时', imgMs + 'ms（4000×3000 封面就绪 ' + nat + '）')
    } else {
      fail('大图导入耗时', '等待 ' + imgMs + 'ms 仍未就绪')
    }
  }

  // 新建项目响应探针（用户反馈：新建也卡顿）——resetProject 后 3s 内主线程最大停顿
  {
    let lastTick = performance.now()
    let gapMax = 0
    const gapTimer = setInterval(() => {
      const now = performance.now()
      gapMax = Math.max(gapMax, now - lastTick)
      lastTick = now
    }, 120)
    project.resetProject()
    await sleep(3000)
    clearInterval(gapTimer)
    if (gapMax < 1500) {
      pass('新建项目响应', '3s 内主线程最大停顿 ' + gapMax.toFixed(0) + 'ms')
    } else {
      fail('新建项目响应', '3s 内主线程最大停顿 ' + gapMax.toFixed(0) + 'ms（>1500ms 卡死级）')
    }
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
  const layerFxRef = useRef<((t: number, audioT?: number) => void) | null>(null)
  const playTimeRef = useRef(0)
  const pb = useAudioPlayback(
    project.assets.audioFile,
    project.layout.visualizer,
    barsHandleRef,
    frameTRef,
    layerFxRef,
    playTimeRef,
    project.layout.audio.leadMs
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
        naturalSize: ce
          ? ((ce as HTMLImageElement).naturalWidth || ce.width) +
            'x' +
            ((ce as HTMLImageElement).naturalHeight || ce.height)
          : null,
        mainImageNodes: mainLayer ? mainLayer.find('Image').length : -1,
        fillMode: projectRef.current.layout.mainImage.fillMode,
        mainRect: JSON.stringify(projectRef.current.layout.mainImage.rect)
      }
    }
    window.__runAudioSmoke = () =>
      stageRef.current
        ? runAudioSmoke(project, pbRef, stageRef.current, projectRef).catch((e) => ({
            ok: false,
            checks: [{ label: '异常', pass: false, detail: String(e) }]
          }))
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
      const runExportOnce = async (): Promise<{
        resolution: string
        phase: string
        seconds: number
        error: string | null
        message: string
        outputPath: string
      }> => {
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
        return {
          resolution: '',
          phase: st.phase,
          seconds: Math.round((performance.now() - started) / 100) / 10,
          error: st.error,
          message: st.encodeInfo ?? st.message,
          outputPath: st.outputPath ?? ''
        }
      }
      for (const rid of resolutions) {
        project.updateText('songTitle', { text: 'smoke-' + rid })
        project.updateExport({ resolutionId: rid, fps: 30 })
        const done = await runExportOnce()
        results.push({ ...done, resolution: rid })
        if (done.phase !== 'done') break
      }
      // 0.5.0/0.6.0：含特效导出（动效+音乐响应默认关→全开一次）——动态路径与 WYSIWYG 端到端
      project.updateBackgroundFx({ kenBurns: 0.05, kenBurnsDuration: 30, bassBrightness: 0.4 })
      project.updateImageFx({ breathe: 0.3, rotateDeg: 1.5, glowPulse: 0.4, border: 0.008 })
      project.updateTextEntry('songTitle', { type: 'typewriter', durationSec: 1.2 })
      project.updateCanvasFx({ vignette: 0.5, grain: 0.2, scanline: 0.15, lightLeak: 0.3 })
      project.updateIntroOutro({ introFade: 1, introTitleCard: 2, outroFade: 1 })
      project.updateVisualizer({ bpm: 120 })
      project.updateBeatFx({ pulse: 0.8, burst: 1, particlePreset: 'snow', particleDensity: 0.6 })
      project.updateExport({ resolutionId: '1080p', fps: 30 })
      project.updateText('songTitle', { text: 'smoke-fx' })
      await sleep(400)
      const fxDone = await runExportOnce()
      results.push({ ...fxDone, resolution: '1080p+fx' })
      // 0.7.0 音频工程端到端：lead 2s + fade 0.5s（视频总长 = 音频 + 2s；黑场/标题卡填充）
      project.updateAudioEngine({ leadMs: 2000, fadeInSec: 0.5, fadeOutSec: 0.5 })
      project.updateIntroOutro({ introFade: 0.5, introTitleCard: 1.5, outroFade: 0.5 })
      project.updateExport({ resolutionId: '720p', fps: 30 })
      project.updateText('songTitle', { text: 'smoke-af' })
      await sleep(400)
      const afDone = await runExportOnce()
      results.push({ ...afDone, resolution: '720p+af' })
      project.updateAudioEngine({ leadMs: 0, fadeInSec: 0, fadeOutSec: 0 })
      // 复位（防污染）——af 的 introOutro 已由下面统一复位
      project.updateBackgroundFx({
        kenBurns: 0,
        kenBurnsDuration: 30,
        bassBrightness: 0,
        bassHue: 0
      })
      project.updateImageFx({ breathe: 0, rotateDeg: 0, glowPulse: 0, border: 0 })
      project.updateTextEntry('songTitle', { type: 'none' })
      project.updateCanvasFx({ vignette: 0, grain: 0, scanline: 0, beatFlash: 0, lightLeak: 0 })
      project.updateIntroOutro({ introFade: 0, introTitleCard: 0, outroFade: 0 })
      project.updateVisualizer({ bpm: null, beatIntervalSec: null })
      project.updateBeatFx({ pulse: 0, burst: 0, particleDensity: 0 })
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
          audioWarning={pb.warning}
          duration={pb.duration}
          timelineDuration={pb.timelineDuration}
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
          backgroundFx={project.layout.background.fx}
          imageFx={project.layout.mainImage.fx}
          songTitleEntry={project.layout.texts.songTitle.entry}
          artistEntry={project.layout.texts.artist.entry}
          canvasFx={project.layout.canvasFx}
          introOutro={project.layout.introOutro}
          onBackgroundFxChange={project.updateBackgroundFx}
          onImageFxChange={project.updateImageFx}
          onSongTitleEntryChange={(x) => project.updateTextEntry('songTitle', x)}
          onArtistEntryChange={(x) => project.updateTextEntry('artist', x)}
          onCanvasFxChange={project.updateCanvasFx}
          onIntroOutroChange={project.updateIntroOutro}
          audio={project.layout.audio}
          onAudioChange={project.updateAudioEngine}
          beat={project.layout.beat}
          visualizerForBeat={project.layout.visualizer}
          onBeatFxChange={project.updateBeatFx}
          onVisualizerForBeatChange={project.updateVisualizer}
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
            analyzer={pb.analyzer}
            layerFxRef={layerFxRef}
            mediaDurationSec={pb.duration}
            playTimeRef={playTimeRef}
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
          analyzer={pb.analyzer}
          mediaDurationSec={pb.duration}
          audioLeadSec={project.layout.audio.leadMs / 1000}
          width={exporter.stageRequest.width}
          height={exporter.stageRequest.height}
          onReady={exporter.onStageReady}
        />
      )}
    </div>
  )
}

export default App
