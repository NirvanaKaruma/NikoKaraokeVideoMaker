import { useCallback, useEffect, useRef, useState } from 'react'

export interface SystemFontsState {
  /** 系统字体族名列表（去重排序） */
  fonts: string[]
  loading: boolean
  error: string | null
  scanned: boolean
  scan: () => Promise<void>
}

/**
 * 系统字体扫描（用户反馈：支持特殊字体如日文字体）。
 * 用 Chromium Local Font Access API；Electron 无权限拦截器时默认授权。
 * 首次进入文本样式页自动扫描一次，也可手动重扫。
 */
export function useSystemFonts(): SystemFontsState {
  const [fonts, setFonts] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [scanned, setScanned] = useState(false)
  const scannedRef = useRef(false)

  const scan = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (typeof window.queryLocalFonts !== 'function') {
        throw new Error('当前环境不支持字体枚举')
      }
      const list = await window.queryLocalFonts()
      const uniq = Array.from(new Set(list.map((f) => f.family).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      )
      setFonts(uniq)
      setScanned(true)
      scannedRef.current = true
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!scannedRef.current) {
      void scan()
    }
  }, [scan])

  return { fonts, loading, error, scanned, scan }
}
