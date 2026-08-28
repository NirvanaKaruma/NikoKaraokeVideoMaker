/**
 * 音频解码 Worker（0.6.0 性能修复：长 MP3 解码曾阻塞主线程 1–3s）。
 * 用 OfflineAudioContext 在 Worker 线程解码（WebAudio 在 DedicatedWorker 可用），
 * 混单声道后以 Transferable Float32Array 零拷贝回传 —— 主线程只做建分析器，UI 不再卡。
 * 兜底：Worker 不可用时主线程回退 decodeAudioData（useAudioPlayback 内 try/catch）。
 */

/** 返回给主线程的 DecodeResult：原始多声道（零拷贝回传；播放保立体声，主线程混单声道做分析） */
interface DecodeResult {
  ok: boolean
  channels: Float32Array[] | null
  sampleRate: number
  error: string | null
}

/** 探测文件原生采样率（避免 decodeAudioData 重采样 48000 上下变频——44.1k/8k 文件尤其明显）：
 * WAV：RIFF fmt 块；MP3：帧头 rate 索引（前 64KB 内搜同步字）。探测失败 → 默认 48000。 */
function guessSampleRate(bytes: Uint8Array): number {
  // WAV: RIFF....WAVE，fmt 块内样品率（偏移 24，LE u32）
  if (
    bytes.length > 44 &&
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46
  ) {
    const rate = bytes[24] | (bytes[25] << 8) | (bytes[26] << 16) | (bytes[27] << 24)
    if (rate >= 8000 && rate <= 96000) return rate
  }
  // MP3: 找 11 位同步 0xFFE.. 帧头（必须跳过 ID3v2——标签内文本可能含假 0xFF 0xE0 同步字）
  let start = 0
  if (bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    const sz =
      ((bytes[6] & 0x7f) << 21) |
      ((bytes[7] & 0x7f) << 14) |
      ((bytes[8] & 0x7f) << 7) |
      (bytes[9] & 0x7f)
    start = 10 + sz
  }
  const limit = Math.min(bytes.length, 65536)
  for (let i = start; i < limit - 4; i++) {
    if (bytes[i] === 0xff && (bytes[i + 1] & 0xe0) === 0xe0) {
      const ver = (bytes[i + 1] >> 3) & 0x03 // 0=2.5, 2=2, 3=1
      const idx = (bytes[i + 2] >> 2) & 0x03
      const v1 = [44100, 48000, 32000, 0]
      const v2 = [22050, 24000, 16000, 0]
      const v25 = [11025, 12000, 8000, 0]
      const rate = ver === 3 ? v1[idx] : ver === 2 ? v2[idx] : v25[idx]
      if (rate >= 8000 && rate <= 96000) return rate
    }
  }
  return 48000
}

self.onmessage = (e: MessageEvent<ArrayBuffer>): void => {
  const bytes = e.data
  void (async () => {
    try {
      const rate = guessSampleRate(new Uint8Array(bytes))
      const octx = new OfflineAudioContext(1, 1, rate)
      const decoded = await octx.decodeAudioData(bytes)
      const channels: Float32Array[] = []
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        channels.push(decoded.getChannelData(c))
      }
      const result: DecodeResult = {
        ok: true,
        channels,
        sampleRate: decoded.sampleRate,
        error: null
      }
      ;(self as unknown as Worker).postMessage(
        result,
        channels.map((c) => c.buffer as ArrayBuffer)
      )
    } catch (err) {
      const result: DecodeResult = {
        ok: false,
        channels: null,
        sampleRate: 0,
        error: err instanceof Error ? err.message : String(err)
      }
      ;(self as unknown as Worker).postMessage(result)
    }
  })()
}
