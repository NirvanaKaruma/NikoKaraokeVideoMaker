import { describe, expect, it } from 'vitest'
import { compareVersions, parseRelease, pickAsset } from './updater'

const asset = (
  name: string,
  digest?: string
): { name: string; browser_download_url: string; size: number; digest?: string } => ({
  name,
  browser_download_url: 'https://github.com/x/y/releases/download/v1.1.0/' + name,
  size: 1234,
  ...(digest ? { digest } : {})
})

describe('compareVersions', () => {
  it('语义化版本严格比较', () => {
    expect(compareVersions('1.1.0', '1.0.9')).toBe(1)
    expect(compareVersions('1.0.9', '1.1.0')).toBe(-1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('1.1', '1.1.0')).toBe(0)
    expect(compareVersions('2.0.0', '10.0.0')).toBe(-1)
    expect(compareVersions('v1.2.0', '1.1.9')).toBe(1)
  })
})

describe('pickAsset', () => {
  it('优先 portable exe（不匹配大小写）', () => {
    const a = pickAsset([asset('Niko-1.1.0-setup.exe'), asset('Niko-1.1.0-PORTABLE.exe')])
    expect(a?.name).toBe('Niko-1.1.0-PORTABLE.exe')
    expect(a?.sha256).toBeUndefined()
  })
  it('无 portable 回退 setup.exe', () => {
    const a = pickAsset([asset('Niko-1.1.0-setup.exe')])
    expect(a?.name).toBe('Niko-1.1.0-setup.exe')
  })
  it('资产无 digest 时 sha256 不设置（主进程按无校验处理）', () => {
    const a = pickAsset([asset('Niko-1.1.0-portable.exe')])
    expect(a?.sha256).toBeUndefined()
  })
  it('digest 前缀剥离', () => {
    const a = pickAsset([asset('Niko-1.1.0-portable.exe', 'sha256:abc123')])
    expect(a?.sha256).toBe('abc123')
  })
  it('无匹配资产 → null', () => {
    expect(pickAsset([asset('linux.AppImage')])).toBeNull()
    expect(pickAsset([])).toBeNull()
  })
})

describe('parseRelease', () => {
  it('无更新（同版本）→ hasUpdate=false 不取资产', () => {
    const r = parseRelease({ tag_name: 'v1.0.0', assets: [asset('a-portable.exe')] }, '1.0.0')
    expect(r.ok).toBe(true)
    expect(r.hasUpdate).toBe(false)
    expect(r.downloadUrl).toBeUndefined()
  })
  it('有更新且有资产 → 完整字段', () => {
    const r = parseRelease(
      {
        tag_name: 'v1.2.0',
        body: 'release notes...',
        assets: [asset('Niko-1.2.0-portable.exe', 'sha256:deadbeef')]
      },
      '1.0.0'
    )
    expect(r.hasUpdate).toBe(true)
    expect(r.latest).toBe('1.2.0')
    expect(r.downloadUrl).toContain('Niko-1.2.0-portable.exe')
    expect(r.sha256).toBe('deadbeef')
    expect(r.notes).toBe('release notes...')
  })
  it('有更新但无资产 → hasUpdate=true + error=no-asset', () => {
    const r = parseRelease({ tag_name: 'v2.0.0', assets: [] }, '1.0.0')
    expect(r.hasUpdate).toBe(true)
    expect(r.error).toBe('no-asset')
  })
  it('空响应 → ok=false parse-failed', () => {
    const r = parseRelease(null, '1.0.0')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('parse-failed')
  })
})
