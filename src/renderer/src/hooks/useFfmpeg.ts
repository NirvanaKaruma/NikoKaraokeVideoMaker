import { useCallback, useEffect, useRef, useState } from 'react'
import type { DownloadProgress, FfmpegStatusReport } from '@shared/ffmpeg'

export interface DownloadState extends DownloadProgress {
  token: string
}

/** ffmpeg 三源状态（T16）：启动异步检测 + 手动刷新 */
export function useFfmpegStatus(): {
  report: FfmpegStatusReport | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const [report, setReport] = useState<FfmpegStatusReport | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    // 让出同步执行路径（effect 内不得同步 setState）
    await Promise.resolve()
    setLoading(true)
    try {
      const r = await window.api.ffmpeg.detect()
      setReport(r)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    // 挂载后异步检测（不阻塞 UI；timer 回调中的 setState 不构成同步级联）
    const timer = setTimeout(() => {
      void refresh()
    }, 0)
    return () => clearTimeout(timer)
  }, [refresh])

  return { report, loading, error, refresh }
}

/** 托管版下载（T17）：进度事件订阅 + 取消 + 完成回调 */
export function useFfmpegDownload(onDone?: () => void): {
  state: DownloadState | null
  error: string | null
  start: (url?: string) => Promise<void>
  cancel: () => void
} {
  const [state, setState] = useState<DownloadState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const onDoneRef = useRef(onDone)
  useEffect(() => {
    onDoneRef.current = onDone
  }, [onDone])

  const start = useCallback(async (url?: string) => {
    const token = crypto.randomUUID()
    setError(null)
    setState({ token, phase: 'downloading', percent: 0, message: '准备下载…' })
    const off = window.api.ffmpeg.onDownloadProgress((p) => {
      setState((s) => (s && s.token === token ? { token, ...p } : s))
    })
    const res = await window.api.ffmpeg.download(token, url || undefined)
    off()
    if (res.ok) {
      setState({ token, phase: 'done', percent: 100, message: '安装完成' })
      onDoneRef.current?.()
    } else {
      setError(res.error ?? '下载失败')
      setState(null)
    }
  }, [])

  const cancel = useCallback(() => {
    if (state) void window.api.ffmpeg.cancelDownload(state.token)
  }, [state])

  return { state, error, start, cancel }
}
