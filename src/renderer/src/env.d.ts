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
  /** 仅 --smoke-visual 无头自测模式注入 */
  __captureStage?: () => string
  __runVisualChecks?: () => VisualCheckReport
  __runAudioSmoke?: () => Promise<VisualCheckReport>
  /** 仅 --smoke-export 无头导出自测模式注入 */
  __runExportSmoke?: (
    resolutions: string[],
    durationSec: number
  ) => Promise<{
    ok: boolean
    results: { resolution: string; phase: string; seconds: number; error: string | null }[]
  }>
}
