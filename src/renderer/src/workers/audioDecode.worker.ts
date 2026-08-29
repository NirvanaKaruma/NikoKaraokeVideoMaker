/**
 * 音频解码 Worker（纯数据，零 WebAudio——实测本环境 Worker 内
 * AudioBuffer / OfflineAudioContext 均不可用，故所有数据操作用纯 typed array）。
 *
 * 流式组装（ffmpeg PCM 路径）：主线程把 ffmpeg 输出的 4MB 交错 f32 块
 * transfer 进来累积，收到 finalize 后在此完成「拼接 → 拆声道 → 混单声道」，
 * 一次性 transfer 回传 { channels, mono }。
 *
 * 主线程只做 ctx.createBuffer + copyToChannel（实测 0–11ms）与建分析器，
 * 彻底消除「preload 全量组装 + contextBridge 大块克隆 + 主线程 mixToMono」
 * 的 GC 卡顿源（一次典型歌曲导入的 ArrayBuffer 流量从 ~500MB 降到 ~150MB）。
 */

/** 回传给主线程的结果：多声道（播放）+ 单声道混音（频谱分析），全部零拷贝 */
interface DecodeResult {
  ok: boolean
  channels: Float32Array[] | null
  mono: Float32Array | null
  sampleRate: number
  error: string | null
}

/** 流式组装请求：chunk 累积 → finalize 触发拼接 */
interface ChunkRequest {
  type: 'chunk'
  data: ArrayBuffer
}

interface FinalizeRequest {
  type: 'finalize'
  channels: number
  sampleRate: number
}

/** 流式组装中间状态（单会话：一次只解码一个文件，重复导入会先 terminate 旧 Worker） */
let streamParts: ArrayBuffer[] = []

function post(result: DecodeResult, transfers: Transferable[] = []): void {
  ;(self as unknown as Worker).postMessage(result, transfers)
}

/** 流式：拼接交错 f32 → 拆声道 → 混单声道，transfer 回传 */
function buildFromPcm(parts: ArrayBuffer[], chN: number, sampleRate: number): void {
  try {
    const total = parts.reduce((s, p) => s + p.byteLength, 0)
    const inter = new Float32Array(Math.floor(total / 4))
    let off = 0
    for (const p of parts) {
      const n = Math.floor(p.byteLength / 4)
      inter.set(new Float32Array(p, 0, n), off)
      off += n
    }
    parts.length = 0
    const len = Math.floor(inter.length / Math.max(1, chN))
    if (len === 0) {
      post({ ok: false, channels: null, mono: null, sampleRate: 0, error: 'empty-pcm' })
      return
    }
    // 拆声道 + 单声道混音在同一个遍历里完成
    const channels: Float32Array[] = []
    const mono = new Float32Array(len)
    for (let c = 0; c < chN; c++) {
      const ch = new Float32Array(len)
      for (let i = 0; i < len; i++) {
        const v = inter[i * chN + c]
        ch[i] = v
        mono[i] += v / chN
      }
      channels.push(ch)
    }
    const transfers = channels.map((c) => c.buffer as ArrayBuffer)
    transfers.push(mono.buffer as ArrayBuffer)
    post({ ok: true, channels, mono, sampleRate, error: null }, transfers)
  } catch (err) {
    post({
      ok: false,
      channels: null,
      mono: null,
      sampleRate: 0,
      error: 'build-fail: ' + (err instanceof Error ? err.message : String(err))
    })
  }
}

self.onmessage = (e: MessageEvent<ArrayBuffer | ChunkRequest | FinalizeRequest>): void => {
  const msg = e.data
  if (typeof msg === 'object' && msg !== null) {
    if ((msg as ChunkRequest).type === 'chunk') {
      // 主线程 transfer 进来的块：只累积，不复制、不解析（内存与 CPU 全在 Worker）
      streamParts.push((msg as ChunkRequest).data)
      return
    }
    if ((msg as FinalizeRequest).type === 'finalize') {
      const req = msg as FinalizeRequest
      buildFromPcm(streamParts, Math.max(1, req.channels), req.sampleRate)
      streamParts = []
      return
    }
  }
}
