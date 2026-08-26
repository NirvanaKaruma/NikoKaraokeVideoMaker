import { useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { SUBTITLE_ZONE_Y } from '@shared/layout'
import { useProject } from './hooks/useProject'
import { CanvasStage } from './components/CanvasStage'
import type { SelectableId } from './components/SceneLayers'
import { InputPanel } from './components/panels/InputPanel'
import { BackgroundPanel } from './components/panels/BackgroundPanel'
import { MainImagePanel } from './components/panels/MainImagePanel'

const IS_VISUAL_SMOKE = new URLSearchParams(window.location.search).has('smokeVisual')

interface VisualCheckItem {
  label: string
  pass: boolean
  detail: string
}

interface VisualCheckReport {
  ok: boolean
  checks: VisualCheckItem[]
}

/** 无头像素校验：对舞台 toCanvas 取样，验证 M2 四层布局落位 */
function runVisualChecks(stage: Konva.Stage): VisualCheckReport {
  const checks: VisualCheckItem[] = []
  const fail = (label: string, detail: string): void => {
    checks.push({ label, pass: false, detail })
  }
  const pass = (label: string, detail: string): void => {
    checks.push({ label, pass: true, detail })
  }
  const canvas = stage.toCanvas({ pixelRatio: 1 })
  const ctx = canvas.getContext('2d')
  if (!ctx) {
    return { ok: false, checks: [{ label: 'canvas', pass: false, detail: 'getContext 失败' }] }
  }
  const scale = Math.min(stage.width() / 1920, stage.height() / 1080)
  const offX = (stage.width() - 1920 * scale) / 2
  const offY = (stage.height() - 1080 * scale) / 2
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

  // 1) 左上角背景：封面铺满 + 模糊，不能是画布底色
  const corner = sample(30, 30)
  if (corner[0] < 25 && corner[1] < 25 && corner[2] < 30) {
    fail('背景铺满', '左上角仍是画布底色 rgb(' + corner.slice(0, 3).join(',') + ')')
  } else {
    pass('背景铺满', '左上角 rgb(' + corner.slice(0, 3).join(',') + ')（封面铺满+模糊生效）')
  }

  // 2) 主图中心：合成封面白色圆盘处应为亮色
  const main = sample(441, 518)
  if (main[0] > 200 && main[1] > 200 && main[2] > 200) {
    pass('主图落位', '主图中心 rgb(' + main.slice(0, 3).join(',') + ') 为白色圆盘')
  } else {
    fail('主图落位', '主图中心 rgb(' + main.slice(0, 3).join(',') + ') 非预期亮色')
  }

  // 3) 文本区：歌名+作者区域应有白色文字像素
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

  // 4) 可视化区：粉/青色频谱柱像素
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

  // 5) 下半区留白：底部中央应是背景（未被元素占用）
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

function App(): React.JSX.Element {
  const project = useProject()
  const [selectedId, setSelectedId] = useState<SelectableId>(null)
  const stageRef = useRef<Konva.Stage | null>(null)

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
    return () => {
      delete window.__captureStage
      delete window.__runVisualChecks
    }
    // 仅无头自测模式生效，project 引用稳定
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1 className="app-title">NikoKaraokeVideoMaker</h1>
        <span className="app-stage-tag">M2 · 编辑器</span>
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
          <MainImagePanel mainImage={project.layout.mainImage} onChange={project.updateMainImage} />
          <BackgroundPanel
            background={project.layout.background}
            onChange={project.updateBackground}
          />
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
