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
  /** 单声道混音（Worker 内算好；WebAudio 路径为 null，由主线程自己混） */
  mono: Float32Array | null
  sampleRate: number
  error: string | null
}

/** ffmpeg PCM 入参：{type:'pcm'} + 原始交错 f32（Transferable）+ 声道数/采样率 */
interface PcmRequest {
  type: 'pcm'
  data: ArrayBuffer
  channels: number
  sampleRate: number
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
  // FLAC: "fLaC" + STREAMINFO，采样率 20 bit（STREAMINFO[10..12]：SI[10]<<12 | SI[11]<<4 | SI[12]>>4）
  if (bytes[0] === 0x66 && bytes[1] === 0x4c && bytes[2] === 0x61 && bytes[3] === 0x43) {
    if (bytes.length > 21) {
      const rate = (bytes[18] << 12) | (bytes[19] << 4) | (bytes[20] >> 4)
      if (rate >= 8000 && rate <= 192000) return rate
    }
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

self.onmessage = (e: MessageEvent<ArrayBuffer | PcmRequest>): void => {
  const msg = e.data
  // ffmpeg PCM：拆交错 → 各声道 + 单声道混音，全部零拷贝回传（主线程零重活）
  if (typeof msg === 'object' && msg !== null && (msg as PcmRequest).type === 'pcm') {
    const req = msg as PcmRequest
    const data = new Float32Array(req.data)
    const chN = Math.max(1, req.channels)
    const len = Math.floor(data.length / chN)
    const channels: Float32Array[] = []
    for (let c = 0; c < chN; c++) {
      const ch = new Float32Array(len)
      const o = c
      for (let i = 0; i < len; i++) ch[i] = data[i * chN + o]
      channels.push(ch)
    }
    const mono = new Float32Array(len)
    for (let i = 0; i < len; i++) {
      let s = 0
      for (let c = 0; c < chN; c++) s += channels[c][i]
      mono[i] = s / chN
    }
    const result: DecodeResult = {
      ok: true,
      channels,
      mono,
      sampleRate: req.sampleRate,
      error: null
    }
    const transfers: ArrayBuffer[] = channels.map((c) => c.buffer as ArrayBuffer)
    transfers.push(mono.buffer as ArrayBuffer)
    ;(self as unknown as Worker).postMessage(result, transfers)
    return
  }
  const bytes = msg as ArrayBuffer
  void (async () => {
    try {
      // 按 ≤48kHz 解码：96k/192k 高解析文件以 48k 通道输出（Chromium 内部按上下文采样率
      // 解码，天然抗混叠）→ 内存上限 ~2×10.6M×4B/声道，避免 21M+ 样本双声道全量驻留
      // 把 V8 堆打到 4GB（用户实测：Deep Blue 96k FLAC OOM，近堆上限 4058MB）。
      const nativeRate = guessSampleRate(new Uint8Array(bytes))
      const rate = Math.min(nativeRate, 48000)
      const octx = new OfflineAudioContext(1, 1, rate)
      const decoded = await octx.decodeAudioData(bytes)
      const channels: Float32Array[] = []
      for (let c = 0; c < decoded.numberOfChannels; c++) {
        channels.push(decoded.getChannelData(c))
      }
      const result: DecodeResult = {
        ok: true,
        channels,
        mono: null,
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
        mono: null,
        sampleRate: 0,
        error: err instanceof Error ? err.message : String(err)
      }
      ;(self as unknown as Worker).postMessage(result)
    }
  })()
}
