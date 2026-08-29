/// <reference types="vite/client" />

interface VisualCheckItem {
  label: string
  pass: boolean
  detail: string
}

interface VisualCheckReport {
  ok: boolean
  checks: VisualCheckItem[]
}

interface Window {
  /** Local Font Access API（Electron 默认授权）：枚举系统全部字体 */
  queryLocalFonts?: () => Promise<
    { family: string; fullName: string; postscriptName: string; style: string }[]
  >
  /** 仅 --smoke-visual 无头自测模式注入 */
  __captureStage?: () => string
  /** 仅 --smoke-visual（封面解码异步，等待就绪后返回） */
  __runVisualChecks?: () => VisualCheckReport | Promise<VisualCheckReport>
  __runAudioSmoke?: () => Promise<VisualCheckReport>
  /** 关闭前未保存确认（main 窗口 close 事件调用） */
  __isDirty?: () => boolean
  __saveAndClose?: () => Promise<boolean>
  /** 仅 --smoke-visual：资产加载诊断 */
  __getAssetDebug?: () => {
    coverFile: string | null
    coverUrl: string | null
    coverElement: boolean
  }
  /** 仅 --smoke-visual：GPU 加速基准（硬件 vs 软件 30 帧实测） */
  __runEncodeBenchmark?: () => Promise<unknown>
  /** 仅 --smoke-project 无头项目保存/加载自测模式注入 */
  __runProjectSmoke?: () => Promise<{ ok: boolean; checks: VisualCheckItem[] }>
  /** 仅 --smoke-export 无头导出自测模式注入 */
  __runExportSmoke?: (
    resolutions: string[],
    durationSec: number
  ) => Promise<{
    ok: boolean
    results: { resolution: string; phase: string; seconds: number; error: string | null }[]
  }>
  /** 仅 --smoke-time：时间轴预览端到端（关键帧/片段切换像素断言 + 引擎插值断言） */
  __runTimeSmoke?: () => Promise<{ ok: boolean; checks: VisualCheckItem[] }>
  /** 仅 --smoke-probe：慢盘背压探针（队列/内存峰值） */
  __runSmokeProbe?: () => Promise<{ ok: boolean; checks: VisualCheckItem[] }>
}
