import { app, dialog, shell, BrowserWindow, ipcMain } from 'electron'
import { writeFile, mkdir, readFile } from 'fs/promises'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { IPC } from '../shared/ipc'
import { setLocale, t } from '../shared/i18n'
import { getConfig, setConfig } from './config'
import { registerFfmpegIpc } from './ffmpegIpc'
import { registerProjectIpc } from './projectIpc'
import { registerMuxIpc } from './muxIpc'
import {
  detectFfmpegStatus,
  detectManagedFfmpeg,
  getFFmpegPath,
  installManagedFfmpeg,
  probeMediaDurationSec
} from './ffmpeg'
import { spawn } from 'child_process'

/** smoke 自测模式：加载渲染页后执行一次 ping 往返，结果写入 smoke-result.txt 并退出 */
/** 环境变量 smoke 通道：portable 启动器不转发 argv，env 会被继承（NIKO_SMOKE=detect|bench|project|visual|export:720p@8|download:default） */
const smokeEnv = process.env['NIKO_SMOKE'] ?? ''
/** smoke 报告输出目录（portable 启动器会把 cwd 改到临时解压目录，退出即删，故必须可指定） */
const smokeDir = process.env['NIKO_SMOKE_DIR'] ?? process.cwd()

const isSmokeTest = process.argv.includes('--smoke-test') || smokeEnv === 'test'
/** smoke-visual 模式：加载渲染页后截图舞台，写入 smoke-stage.png 并退出（M2 无头目视自测） */
const isSmokeVisual = process.argv.includes('--smoke-visual') || smokeEnv === 'visual'
/** smoke-export 模式：无头端到端导出（--smoke-export=720p,1080p@35 / NIKO_SMOKE=export:720p,1080p@35） */
const exportArgFromEnv = smokeEnv.startsWith('export:')
  ? '--smoke-export=' + smokeEnv.slice(7)
  : undefined
const smokeExportArg = process.argv.find((a) => a.startsWith('--smoke-export=')) ?? exportArgFromEnv
const isSmokeExport = smokeExportArg !== undefined

/** smoke-bench：GPU 加速基准（硬件 vs 软件 30 帧实测）落盘 */
const isSmokeBench = process.argv.includes('--smoke-bench') || smokeEnv === 'bench'
/** smoke-project：项目保存/加载自测 */
const isSmokeProject = process.argv.includes('--smoke-project') || smokeEnv === 'project'
/** smoke-time（1.0.0 T10a）：时间轴预览端到端——关键帧/片段切换像素断言 + 引擎插值断言 */
const isSmokeTime = process.argv.includes('--smoke-time') || smokeEnv === 'time'
/** smoke-probe（1.0.0 T10b）：慢盘背压探针（NIKO_SMOKE_PROBE_RATE=字节/秒 限速）——窗口×队列×内存 */
const isSmokeProbe = process.argv.includes('--smoke-probe') || smokeEnv === 'probe'
/** smoke-detect：只做三源检测并落盘（来源矩阵测试用，配合 PATH 操控） */
const isSmokeDetect = process.argv.includes('--smoke-detect') || smokeEnv === 'detect'
/** smoke-download：走一遍托管安装（--smoke-download=default 或完整 URL / file:// 本地镜像） */
const downloadArgFromEnv = smokeEnv.startsWith('download:')
  ? '--smoke-download=' + smokeEnv.slice(9)
  : undefined
const smokeDownloadArg =
  process.argv.find((a) => a.startsWith('--smoke-download=')) ?? downloadArgFromEnv
function parseSmokeExport(): { resolutions: string[]; durationSec: number } {
  const body = (smokeExportArg ?? '').split('=')[1] ?? ''
  const [resPart, durPart] = body.split('@')
  return {
    resolutions: resPart ? resPart.split(',').filter(Boolean) : ['720p'],
    durationSec: durPart ? Number(durPart) : 35
  }
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    title: 'NikoKaraokeVideoMaker',
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      // 导出编码期间即使窗口最小化/隐藏也不节流定时器（否则编码速度骤降）
      backgroundThrottling: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    if (
      !isSmokeTest &&
      !isSmokeVisual &&
      !isSmokeExport &&
      !isSmokeBench &&
      !isSmokeProject &&
      !isSmokeTime &&
      !isSmokeProbe
    )
      mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // 关闭前未保存确认（用户反馈）：保存并退出 / 不保存直接退出 / 取消
  const isSmokeMode =
    isSmokeTest ||
    isSmokeVisual ||
    isSmokeExport ||
    isSmokeBench ||
    isSmokeProject ||
    isSmokeTime ||
    isSmokeProbe ||
    isSmokeDetect ||
    smokeDownloadArg !== undefined
  if (!isSmokeMode) {
    let allowClose = false
    mainWindow.on('close', (e) => {
      if (allowClose) return
      e.preventDefault()
      void (async () => {
        try {
          const dirty: unknown =
            await mainWindow.webContents.executeJavaScript('window.__isDirty()')
          if (dirty !== true) {
            allowClose = true
            mainWindow.close()
            return
          }
          const res = await dialog.showMessageBox(mainWindow, {
            type: 'warning',
            title: 'NikoKaraokeVideoMaker',
            message: t('closeGuard.title'),
            detail: t('closeGuard.detail'),
            buttons: [t('closeGuard.saveExit'), t('closeGuard.exitNoSave'), t('closeGuard.cancel')],
            defaultId: 0,
            cancelId: 2,
            noLink: true
          })
          if (res.response === 0) {
            const saved: unknown =
              await mainWindow.webContents.executeJavaScript('window.__saveAndClose()')
            if (saved === true) {
              allowClose = true
              mainWindow.close()
            }
          } else if (res.response === 1) {
            allowClose = true
            mainWindow.close()
          }
        } catch (error) {
          console.error('[close-guard] 失败，直接关闭:', error)
          allowClose = true
          mainWindow.close()
        }
      })()
    })
  }

  // HMR for renderer base on electron-vite cli.
  if (isSmokeVisual || isSmokeBench) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeVisual: '1' } })
  } else if (isSmokeExport) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeExport: '1' } })
  } else if (isSmokeProject) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeProject: '1' } })
  } else if (isSmokeTime) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeTime: '1' } })
  } else if (isSmokeProbe) {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { smokeProbe: '1' } })
  } else if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

function registerIpcHandlers(): void {
  // M1 hello：验证 renderer → main 往返链路
  ipcMain.handle(IPC.appPing, () => 'pong')

  // 探针：读取本地文件字节（仅 smoke 诊断用：NIKO_AUDIO_PROBE 真实音频导入计时）
  ipcMain.handle('fs:read-bytes', async (_e, p: string) => {
    const b = await readFile(p)
    return new Uint8Array(b)
  })

  // i18n：读取/保存界面语言偏好（renderer 启动时读取，切换时写回）
  ipcMain.handle(IPC.appGetLocale, async () => (await getConfig()).locale)
  ipcMain.handle(IPC.appSetLocale, async (_e, locale: unknown) => {
    const ok = locale === 'zh-cn' || locale === 'en' || locale === 'jp'
    if (!ok) return (await getConfig()).locale
    const cfg = await setConfig({ locale })
    if (cfg.locale === 'zh-cn' || cfg.locale === 'en' || cfg.locale === 'jp') {
      setLocale(cfg.locale)
    }
    return cfg.locale
  })
}

async function runSmokeVisual(win: BrowserWindow): Promise<void> {
  try {
    // 真实音频导入探针（NIKO_AUDIO_PROBE=音频路径）：注入路径 → smoke 经 IPC 读字节并计时
    const probePath = process.env['NIKO_AUDIO_PROBE']
    if (probePath) {
      try {
        await win.webContents.executeJavaScript(
          'window.__NIKO_PROBE_AUDIO_PATH = ' + JSON.stringify(probePath) + '; true'
        )
        console.log('[smoke-visual] 音频探针已注入:', probePath)
      } catch (err) {
        console.error('[smoke-visual] 音频探针读取失败:', err)
      }
    }
    const dataUrl: unknown = await win.webContents.executeJavaScript('window.__captureStage()')
    if (typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
      await writeFile(
        join(process.cwd(), 'smoke-stage.png'),
        Buffer.from(dataUrl.split(',')[1], 'base64')
      )
      console.log('[smoke-visual] 舞台截图已保存 smoke-stage.png')
    } else {
      console.error('[smoke-visual] 未获取到截图数据')
      app.exit(1)
      return
    }
    const report: unknown = await win.webContents.executeJavaScript('window.__runVisualChecks()')
    const staticOk = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-visual] 像素校验:', staticOk ? '全部通过' : '存在失败项')

    // M3：音频链路校验（WAV File → 解码 → FFT → 频谱渲染动态变化）
    const audioReport: unknown = await win.webContents.executeJavaScript('window.__runAudioSmoke()')
    const audioOk = (audioReport as { ok?: boolean })?.ok === true
    console.log('[smoke-visual] 音频频谱校验:', audioOk ? '全部通过' : '存在失败项')

    const assetDebug: unknown = await win.webContents
      .executeJavaScript('window.__getAssetDebug()')
      .catch(() => null)
    await writeFile(
      join(smokeDir, 'smoke-visual-report.json'),
      JSON.stringify(
        { static: report, audio: audioReport, assets: assetDebug, ok: staticOk && audioOk },
        null,
        2
      ),
      'utf-8'
    )
    app.exit(staticOk && audioOk ? 0 : 1)
  } catch (error) {
    console.error('[smoke-visual] 截图失败:', error)
    app.exit(1)
  }
}

/** T10a：时间轴预览端到端（关键帧/片段切换像素断言 + 引擎插值断言）——预览即解析即渲染链路 */
async function runSmokeTime(win: BrowserWindow): Promise<void> {
  try {
    const report: unknown = await win.webContents.executeJavaScript('window.__runTimeSmoke()')
    await writeFile(
      join(smokeDir, 'smoke-time-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    const ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-time]', ok ? '全部通过' : '存在失败项')
    console.log(JSON.stringify(report, null, 2))
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-time] 失败:', error)
    app.exit(1)
  }
}

/** T10b 慢盘背压探针：renderer 走真实 muxer 链（NIKO_SMOKE_PROBE_RATE 限速 ACK）→ 队列/内存峰值落盘 */
async function runSmokeProbe(win: BrowserWindow): Promise<void> {
  try {
    const report: unknown = await win.webContents.executeJavaScript('window.__runSmokeProbe()')
    await writeFile(
      join(smokeDir, 'smoke-probe-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    const ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-probe]', ok ? '全部通过' : '存在失败项')
    console.log(JSON.stringify(report, null, 2))
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-probe] 失败:', error)
    app.exit(1)
  }
}

async function runSmokeProject(win: BrowserWindow): Promise<void> {
  try {
    const report: unknown = await win.webContents.executeJavaScript('window.__runProjectSmoke()')
    await writeFile(
      join(smokeDir, 'smoke-project-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    const ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-project]', ok ? '全部通过' : '存在失败')
    console.log(JSON.stringify(report, null, 2))
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-project] 失败:', error)
    app.exit(1)
  }
}

/** 抽帧亮度统计（signalstats）：返回 { avg, max }（YUV Y 分量 0–255）；失败 null */
async function lumaStatsAt(
  ff: string,
  outputPath: string,
  tSec: number,
  extraVf?: string
): Promise<{ avg: number; max: number } | null> {
  try {
    const vf = ['signalstats,metadata=print', extraVf].filter(Boolean).join(',')
    const res = await new Promise<string>((resolve, reject) => {
      const p = spawn(ff, [
        '-hide_banner',
        '-ss',
        String(tSec),
        '-i',
        outputPath,
        '-frames:v',
        '1',
        '-vf',
        vf,
        '-f',
        'null',
        '-'
      ])
      let out = ''
      p.stderr.on('data', (d) => (out += String(d)))
      p.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error('luma exit ' + code))))
      p.on('error', reject)
    })
    const avg = /YAVG=([0-9.]+)/.exec(res)
    const max = /YMAX=([0-9.]+)/.exec(res)
    if (!avg || !max) return null
    return { avg: Number(avg[1]), max: Number(max[1]) }
  } catch {
    return null
  }
}

/** 0.7.0 音频工程端到端校验：时长 = 音频 + lead；t≈0.5s 黑场（lead）；标题卡可读；
 * 片尾淡出双边帧差异（outro 在动）；末帧近黑（outro 完成）。 */
async function verifyAudioEngineExport(outputPath: string, durationSec: number): Promise<boolean> {
  const LEAD = 2
  const ff = await getFFmpegPath()
  if (!ff) {
    console.log('[smoke-export] af 校验: 跳过（无 ffmpeg）')
    return true
  }
  const artifacts = join(smokeDir, 'TEST-ARTIFACTS')
  await mkdir(artifacts, { recursive: true })
  const diag = (label: string, st: { avg: number; max: number } | null): void => {
    console.log(
      '[smoke-export] af 校验 ' +
        label +
        ': ' +
        (st ? 'YAVG=' + st.avg.toFixed(1) + ' YMAX=' + st.max.toFixed(0) : '统计失败')
    )
  }
  try {
    // 1) 时长 = 音频 + 2s（±1.2s 容差）
    const dur = await probeMediaDurationSec(ff, outputPath)
    const expected = durationSec + LEAD
    if (dur == null) {
      console.log('[smoke-export] af 校验: 失败（无法读取时长）')
      return false
    }
    if (Math.abs(dur - expected) > 1.2) {
      console.log(
        '[smoke-export] af 校验: 失败（时长 ' +
          dur.toFixed(2) +
          's ≠ ' +
          expected.toFixed(2) +
          's = 音频+' +
          LEAD +
          's）'
      )
      return false
    }
    // 2) 抽帧（同时落盘 TEST-ARTIFACTS 供目视）
    const grab = async (
      label: string,
      tSec: number
    ): Promise<{ avg: number; max: number } | null> => {
      const p = join(artifacts, 'af-' + label + '.png')
      await new Promise<void>((resolve) => {
        const child = spawn(ff, ['-y', '-ss', String(tSec), '-i', outputPath, '-frames:v', '1', p])
        child.on('close', () => resolve())
      })
      const st = await lumaStatsAt(ff, outputPath, tSec)
      diag(label + ' (t=' + tSec + 's)', st)
      return st
    }
    const lead = await grab('lead', 0.5) // 前导段 → 全黑
    const title = await grab('title', LEAD + 1.5) // 标题卡全显（intro 0.5 后窗口 [0.875,1.625] 音频轴）
    const mid = await grab('mid', LEAD + durationSec * 0.5) // 音乐中段 → 画面可见
    const fadeA = await grab('fade-a', LEAD + durationSec - 0.5) // 淡出起（outro 0.0–）
    const fadeB = await grab('fade-b', LEAD + durationSec - 0.2) // 淡出中（outro ≈0.6）
    const last = await grab('end', LEAD + durationSec - 0.05) // 片尾（outro →1）
    if (!lead || !title || !mid || !fadeA || !fadeB || !last) {
      console.log('[smoke-export] af 校验: 失败（亮度统计缺失）')
      return false
    }
    // 标题卡检查：标题行带状区域亮度峰值（白色文字出现）
    const titleStripe = await lumaStatsAt(
      ff,
      outputPath,
      LEAD + 1.5,
      'crop=iw/2:ih*0.16:iw/4:ih*0.30'
    )
    const checks: { name: string; pass: boolean; detail: string }[] = [
      {
        // H.264 有限范围：纯黑 ≈ Y=16（BT.601/709 black level），故用「均匀且暗」判定
        name: 'lead 黑场',
        pass: lead.max < 24 && lead.max - lead.avg < 8,
        detail: 'YAVG=' + lead.avg.toFixed(1) + ' YMAX=' + lead.max.toFixed(0)
      },
      {
        name: '标题卡文字（title 带状 YMAX）',
        pass: titleStripe != null && titleStripe.max > 80,
        detail: titleStripe != null ? 'YMAX=' + titleStripe.max.toFixed(0) : '统计失败'
      },
      { name: '音乐中段可见', pass: mid.avg > 15, detail: 'YAVG=' + mid.avg.toFixed(1) },
      {
        name: '淡出段帧间差异（outro 在动）',
        pass: Math.abs(fadeA.avg - fadeB.avg) > 1.5,
        detail: 'dAVG=' + Math.abs(fadeA.avg - fadeB.avg).toFixed(1)
      },
      {
        // outro≈1（黑幕叠加 90%+）：平均亮度应远低于淡出起点帧
        name: '片尾近黑（outro 完成）',
        pass: last.avg < fadeA.avg * 0.35 && last.avg < 70,
        detail: 'YAVG=' + last.avg.toFixed(1) + '（fadeA ' + fadeA.avg.toFixed(1) + '）'
      }
    ]
    const allPass = checks.every((c) => c.pass)
    console.log(
      '[smoke-export] af 校验: ' +
        (allPass ? '通过' : '失败') +
        '（时长 ' +
        dur.toFixed(2) +
        's；' +
        checks.map((c) => c.name + (c.pass ? ' ✓' : ' ✗')).join('，') +
        '）'
    )
    return allPass
  } catch (e) {
    console.log('[smoke-export] af 校验: 异常 ' + String(e))
    return false
  }
}

async function runSmokeBench(win: BrowserWindow): Promise<void> {
  try {
    const report: unknown = await win.webContents.executeJavaScript('window.__runEncodeBenchmark()')
    await writeFile(
      join(smokeDir, 'smoke-bench-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    console.log('[smoke-bench]', JSON.stringify(report, null, 2))
    app.exit(0)
  } catch (error) {
    console.error('[smoke-bench] 失败:', error)
    app.exit(1)
  }
}

/** ffprobe/ffmpeg 提取：验证含特效导出的时长与帧存在（0.5.0 T11 端到端） */
async function verifyFxExport(outputPath: string, durationSec: number): Promise<boolean> {
  const ff = await getFFmpegPath()
  if (!ff) {
    console.log('[smoke-export] fx 校验: 跳过（无 ffmpeg）')
    return true
  }
  try {
    const probe = await new Promise<string>((resolve, reject) => {
      const p = spawn(ff, ['-i', outputPath, '-hide_banner'])
      let out = ''
      p.stderr.on('data', (d) => (out += String(d)))
      p.on('close', (code) =>
        code === 1 ? resolve(out) : reject(new Error('probe 未按预期退出 ' + code))
      )
      p.on('error', reject)
    })
    const durMatch = probe.match(/Duration: (\d{2}):(\d{2}):(\d{2}\.\d{2})/)
    if (!durMatch) {
      console.log('[smoke-export] fx 校验: 失败（无法读取时长）')
      return false
    }
    const h = Number(durMatch[1])
    const m = Number(durMatch[2])
    const s = Number(durMatch[3])
    const dur = h * 3600 + m * 60 + s
    if (Math.abs(dur - durationSec) > 1.2) {
      console.log('[smoke-export] fx 校验: 失败（时长 ' + dur + 's ≠ ' + durationSec + 's）')
      return false
    }
    // 抽帧 1.5s（片头淡入后、特效可见区）
    const framePath = join(smokeDir, 'TEST-ARTIFACTS', 'fx-frame.png')
    await mkdir(join(smokeDir, 'TEST-ARTIFACTS'), { recursive: true })
    await new Promise<void>((resolve) => {
      const p = spawn(ff, ['-y', '-ss', '1.5', '-i', outputPath, '-frames:v', '1', framePath])
      p.on('close', () => resolve())
    })
    console.log(
      '[smoke-export] fx 校验: 通过（时长 ' + dur.toFixed(2) + 's，抽帧 ' + framePath + '）'
    )
    return true
  } catch (e) {
    console.log('[smoke-export] fx 校验: 异常 ' + String(e))
    return false
  }
}

async function runSmokeExport(win: BrowserWindow): Promise<void> {
  try {
    const { resolutions, durationSec } = parseSmokeExport()
    console.log('[smoke-export] 分辨率:', resolutions.join(','), '时长:', durationSec + 's')
    // T10b 内存验收：导出期间轮询渲染进程堆峰值（含在报告里）
    let heapPeakMB = 0
    const heapTimer = setInterval(() => {
      void win.webContents
        .executeJavaScript('(performance.memory?.usedJSHeapSize ?? 0)')
        .then((v) => {
          heapPeakMB = Math.max(heapPeakMB, Math.round((Number(v) || 0) / 1048576))
        })
        .catch(() => undefined)
    }, 1000)
    const report: unknown = await win.webContents.executeJavaScript(
      'window.__runExportSmoke(' + JSON.stringify(resolutions) + ', ' + durationSec + ')'
    )
    clearInterval(heapTimer)
    if (report && typeof report === 'object') {
      ;(report as Record<string, unknown>).heapPeakMB = heapPeakMB
    }
    await writeFile(
      join(smokeDir, 'smoke-export-report.json'),
      JSON.stringify(report, null, 2),
      'utf-8'
    )
    let ok = (report as { ok?: boolean })?.ok === true
    console.log('[smoke-export] 结果:', ok ? '全部成功' : '存在失败')
    console.log(JSON.stringify(report, null, 2))
    // 0.5.0：含特效导出校验（时长 + 抽帧）
    const fxEntry = (
      report as { results?: Array<{ resolution?: string; phase?: string; outputPath?: string }> }
    )?.results?.find((r) => (r.resolution ?? '').includes('fx'))
    if (ok && fxEntry?.phase === 'done' && fxEntry.outputPath) {
      ok = await verifyFxExport(fxEntry.outputPath, durationSec)
    }
    // 0.7.0：音频工程导出校验（lead 2s + fade 0.5s：时长 + 黑场/标题卡/淡出帧）
    const afEntry = (
      report as { results?: Array<{ resolution?: string; phase?: string; outputPath?: string }> }
    )?.results?.find((r) => (r.resolution ?? '').includes('af'))
    if (ok && afEntry?.phase === 'done' && afEntry.outputPath) {
      ok = await verifyAudioEngineExport(afEntry.outputPath, durationSec)
    }
    app.exit(ok ? 0 : 1)
  } catch (error) {
    console.error('[smoke-export] 失败:', error)
    app.exit(1)
  }
}

async function runSmokeTest(win: BrowserWindow): Promise<void> {
  try {
    const result: unknown = await win.webContents.executeJavaScript('window.api.ping()')
    await writeFile(join(process.cwd(), 'smoke-result.txt'), 'PING_OK:' + String(result), 'utf-8')
    console.log('[smoke] IPC 往返成功:', result)
    app.exit(0)
  } catch (error) {
    await writeFile(join(process.cwd(), 'smoke-result.txt'), 'PING_FAIL:' + String(error), 'utf-8')
    console.error('[smoke] IPC 往返失败:', error)
    app.exit(1)
  }
}

if (isSmokeVisual || isSmokeExport || isSmokeTime) {
  // 无头自测：无用户手势也允许音频上下文运行
  app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
}

app.whenReady().then(async () => {
  // 来源矩阵自测：只做三源检测并落盘
  if (isSmokeDetect) {
    try {
      const status = await detectFfmpegStatus()
      await writeFile(
        join(smokeDir, 'smoke-detect-report.json'),
        JSON.stringify(status, null, 2),
        'utf-8'
      )
      console.log(
        '[smoke-detect] effective:',
        JSON.stringify({
          available: status.effective.available,
          source: status.effective.source,
          path: status.effective.path,
          system: status.system?.version ?? null,
          managed: status.managed?.version ?? null,
          custom: status.custom?.version ?? null
        })
      )
      app.exit(0)
    } catch (error) {
      console.error('[smoke-detect] 失败:', error)
      app.exit(1)
    }
    return
  }

  // 托管安装自测：真实下载（或本地镜像）→ 解压 → 校验
  if (smokeDownloadArg) {
    try {
      const urlPart = smokeDownloadArg.split('=')[1] ?? 'default'
      const url = urlPart === 'default' ? undefined : urlPart
      console.log('[smoke-download] 开始安装，URL:', url ?? '(默认 gyan.dev)')
      const info = await installManagedFfmpeg({
        token: 'smoke-download',
        url,
        onProgress: (p) => {
          console.log(
            '[smoke-download]',
            p.phase,
            p.percent != null ? p.percent + '%' : '',
            p.message
          )
        }
      })
      const managed = await detectManagedFfmpeg()
      const report = { install: info, managed }
      await writeFile(
        join(smokeDir, 'smoke-download-report.json'),
        JSON.stringify(report, null, 2),
        'utf-8'
      )
      console.log('[smoke-download] 安装成功:', info.version, '| aac:', info.hasAac)
      app.exit(0)
    } catch (error) {
      console.error('[smoke-download] 失败:', error)
      app.exit(1)
    }
    return
  }

  // 应用用户模型 ID（Windows 通知/任务栏分组）
  electronApp.setAppUserModelId('com.niko.karaoke')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerIpcHandlers()
  registerFfmpegIpc()
  registerProjectIpc()
  registerMuxIpc()
  // i18n：启动时按持久化偏好设置全局语言（默认 zh-cn，异步完成不影响 UI）
  void getConfig().then((cfg) => {
    if (cfg.locale === 'zh-cn' || cfg.locale === 'en' || cfg.locale === 'jp') setLocale(cfg.locale)
  })

  const mainWindow = createWindow()
  if (isSmokeTest) {
    mainWindow.webContents.once('did-finish-load', () => {
      void runSmokeTest(mainWindow)
    })
  }
  if (isSmokeVisual) {
    mainWindow.webContents.once('did-finish-load', () => {
      // 等待 React 挂载 + 合成封面加载 + Konva 缓存完成
      setTimeout(() => {
        void runSmokeVisual(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeExport) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeExport(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeBench) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeBench(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeProject) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeProject(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeTime) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeTime(mainWindow)
      }, 3500)
    })
  }
  if (isSmokeProbe) {
    mainWindow.webContents.once('did-finish-load', () => {
      setTimeout(() => {
        void runSmokeProbe(mainWindow)
      }, 3500)
    })
  }

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
