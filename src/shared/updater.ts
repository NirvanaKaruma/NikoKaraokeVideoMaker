/**
 * 自更新（1.0.0）——纯函数层：semver 比较 + GitHub release 解析。
 * 仓库已公开：检测走 api.github.com（匿名可读），下载走 release 资产直链（浏览器下载 URL）。
 * 平台产物约定：portable exe 资产名含 '-portable'（electron-builder portable.artifactName）。
 */

/** 下载进度（main → renderer 事件） */
export interface DownloadProgress {
  phase: 'connecting' | 'downloading' | 'verifying' | 'done' | 'error'
  percent: number
  receivedBytes: number
  totalBytes: number
}

/** 更新检查结果（renderer UI 用） */
export interface UpdateCheckResult {
  ok: boolean
  /** 本地版本（app.getVersion()） */
  current: string
  /** 最新版本（release tag 去 v 前缀；无更新时 = current） */
  latest: string
  hasUpdate: boolean
  /** release 说明（body，前 500 字） */
  notes?: string
  /** 匹配产物的下载 URL（无匹配/无更新时 null） */
  downloadUrl?: string
  /** 资产 SHA-256（hex；GitHub asset digest 字段「sha256:…」去前缀） */
  sha256?: string
  /** 资产大小（字节；进度条分母） */
  sizeBytes?: number
  assetName?: string
  error?: string
}

/** semver 严格比较：a>b → 1，a<b → -1，相等 → 0；无效段按 0 处理（容忍 '1.0' 等） */
export function compareVersions(a: string, b: string): number {
  const pa = String(a)
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((s) => parseInt(s, 10) || 0)
  const pb = String(b)
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((s) => parseInt(s, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x !== y) return x > y ? 1 : -1
  }
  return 0
}

/** 从 release JSON 选平台匹配资产（portable exe 优先；无则 setup.exe） */
export function pickAsset(
  assets: { name: string; browser_download_url: string; size?: number; digest?: string }[]
): { name: string; url: string; size?: number; sha256?: string } | null {
  const p = assets.find((a) => a.browser_download_url && /-portable\.exe$/i.test(a.name))
  const s = assets.find((a) => a.browser_download_url && /-setup\.exe$/i.test(a.name))
  const a = p ?? s
  if (!a) return null
  return {
    name: a.name,
    url: a.browser_download_url,
    size: a.size,
    sha256: a.digest?.replace(/^sha256:/i, '')
  }
}

/** 解析 GitHub releases API 响应 → UpdateCheckResult（不查网络，纯函数） */
export function parseRelease(
  resp: {
    tag_name: string
    body?: string | null
    assets?: { name: string; browser_download_url: string; size?: number; digest?: string }[]
  } | null,
  current: string
): UpdateCheckResult {
  if (!resp || !resp.tag_name) {
    return { ok: false, current, latest: current, hasUpdate: false, error: 'parse-failed' }
  }
  const latest = String(resp.tag_name).replace(/^v/i, '')
  const hasUpdate = compareVersions(latest, current) > 0
  if (!hasUpdate) {
    return { ok: true, current, latest, hasUpdate: false }
  }
  const asset = pickAsset(resp.assets ?? [])
  if (!asset) {
    // 有版本但无匹配资产：仍提示更新，只是不能一键下载
    return {
      ok: true,
      current,
      latest,
      hasUpdate: true,
      notes: (resp.body ?? '').slice(0, 500),
      error: 'no-asset'
    }
  }
  return {
    ok: true,
    current,
    latest,
    hasUpdate: true,
    notes: (resp.body ?? '').slice(0, 500),
    downloadUrl: asset.url,
    sha256: asset.sha256,
    sizeBytes: asset.size,
    assetName: asset.name
  }
}
