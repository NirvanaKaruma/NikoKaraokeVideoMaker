/**
 * 1.0.0 T7b 流式写盘（renderer 侧）：分块 invoke 写（带字节偏移 position）→ main 定位写盘。
 *
 * 协议：每块一次 muxer:write(jobId, buffer, position) invoke，resolve 由主进程 fs.write 回调触发
 * （= ACK，背压③）。主进程按 position 定位写 → muxer 乱序调用 onData 也正确落盘；
 * renderer 侧 FIFO 队列 + queuedBytes 记账供 encodeVideo 每帧 throttle（积压有界）。
 */
export const STREAM_CHUNK_BYTES = 4 * 1024 * 1024

export interface DiskStreamSink {
  /** 写入一块（position = 文件字节偏移；主进程定位写） */
  write: (data: Uint8Array, position?: number) => Promise<void>
  /** 背压：等待积压字节降到 cap 以下（encodeVideo 每帧编码前调用） */
  throttle: (capBytes: number) => Promise<void>
  /** 等待全部已发送块 ACK（finalize 后调用） */
  flush: () => Promise<void>
  /** 正常收尾：主进程关 fd → 临时文件路径 */
  finish: () => Promise<string>
  /** 取消/失败：主进程关 fd 并删临时文件 */
  cancel: () => Promise<void>
  /** 主进程写错误回调（可读提示经 UI 抛出） */
  onError: (cb: (msg: string) => void) => void
}

interface Pending {
  pos: number
  size: number
  ab: ArrayBuffer
  resolve: () => void
  reject: (err: Error) => void
}

interface CapWaiter {
  capBytes: number
  resolve: () => void
}

export function openDiskStream(jobId: string): DiskStreamSink {
  const queue: Pending[] = []
  let inflight: Pending | null = null
  let queuedBytes = 0
  let closed = false
  let errorMsg: string | null = null
  const waiters: CapWaiter[] = []
  let errorCb: ((msg: string) => void) | null = null

  const finishWaiter = (): void => {
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (queuedBytes <= waiters[i].capBytes) {
        const w = waiters[i]
        waiters.splice(i, 1)
        w.resolve()
      }
    }
  }
  const releaseAllWaiters = (): void => {
    while (waiters.length) waiters.shift()!.resolve()
  }

  const fail = (msg: string): void => {
    closed = true
    errorMsg = msg
    const err = new Error(msg)
    if (inflight) {
      inflight.reject(err)
      inflight = null
    }
    while (queue.length) queue.shift()!.reject(err)
    releaseAllWaiters()
    errorCb?.(msg)
  }

  const pump = (): void => {
    if (closed || inflight || queue.length === 0) return
    const cur = queue.shift()!
    inflight = cur
    void window.api.muxer
      .write(jobId, cur.ab, cur.pos)
      .then(() => {
        if (inflight !== cur) return
        inflight = null
        queuedBytes -= cur.size
        finishWaiter()
        cur.resolve()
        pump()
      })
      .catch((err: unknown) => {
        fail(err instanceof Error ? err.message : String(err))
      })
  }

  const drain = (): Promise<void> =>
    new Promise<void>((resolve, reject) => {
      if (closed) {
        reject(new Error(errorMsg ?? 'mux closed'))
        return
      }
      const tick = (): void => {
        if (closed) reject(new Error(errorMsg ?? 'mux closed'))
        else if (queue.length === 0 && !inflight) resolve()
        else setTimeout(tick, 20)
      }
      tick()
    })

  return {
    write: (data, position) =>
      new Promise<void>((resolve, reject) => {
        if (closed) {
          reject(new Error(errorMsg ?? 'mux closed'))
          return
        }
        // 拷贝到独立 ArrayBuffer（mp4-muxer 的 onData 缓冲可能被复用）
        const copy = new Uint8Array(data.byteLength)
        copy.set(data)
        queue.push({
          pos: position ?? 0,
          size: copy.byteLength,
          ab: copy.buffer,
          resolve,
          reject
        })
        queuedBytes += copy.byteLength
        pump()
      }),
    throttle: (capBytes) =>
      new Promise<void>((resolve) => {
        if (queuedBytes <= capBytes) {
          resolve()
          return
        }
        waiters.push({ capBytes, resolve })
      }),
    flush: drain,
    finish: async () => {
      await drain()
      const res = await window.api.muxer.finish(jobId)
      if (!res.ok || !res.target) throw new Error(res.error ?? 'finish failed')
      return res.target
    },
    cancel: async () => {
      closed = true
      const err = new Error('cancelled')
      if (inflight) {
        inflight.reject(err)
        inflight = null
      }
      while (queue.length) queue.shift()!.reject(err)
      await window.api.muxer.cancel(jobId).catch(() => false)
    },
    onError: (cb) => {
      errorCb = cb
    }
  }
}
