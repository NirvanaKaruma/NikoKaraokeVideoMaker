/**
 * 共享频谱分析器（核心约束 A 的音频侧）：
 * 预览（rAF 取 currentTime）与导出（逐帧时刻 t）调用同一个 spectrumAt，
 * 保证所见即所得。纯 TS、无 DOM 依赖，可在 Node 环境单测。
 */

export interface SpectrumAnalyzer {
  sampleRate: number
  /** 单声道样本（多声道已平均） */
  samples: Float32Array
  duration: number
  fftSize: number
  freqMin: number
  freqMax: number
  window: Float32Array
  twiddles: Float32Array
  bitRev: Int32Array
}

export interface SpectrumOptions {
  /** 2 的幂，默认 8192（bin≈5.9Hz@48k：低频段多柱共用同一 FFT bin 的问题——2048 时 30–50Hz 仅 1 个 bin，多根柱数值相同） */
  fftSize?: number
  freqMin?: number
  freqMax?: number
}

/** 多声道 → 单声道平均 */
export function mixToMono(channels: Float32Array[], length: number): Float32Array {
  if (channels.length === 1) return channels[0]
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let s = 0
    for (let c = 0; c < channels.length; c++) s += channels[c][i]
    out[i] = s / channels.length
  }
  return out
}

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function makeBitRev(n: number): Int32Array {
  const out = new Int32Array(n)
  const bits = Math.log2(n)
  for (let i = 0; i < n; i++) {
    let r = 0
    let x = i
    for (let b = 0; b < bits; b++) {
      r = (r << 1) | (x & 1)
      x >>= 1
    }
    out[i] = r
  }
  return out
}

function makeTwiddles(n: number): Float32Array {
  const out = new Float32Array(n) // 长度 n，存 n/2 对 (cos, sin)
  for (let k = 0; k < n / 2; k++) {
    const angle = (-2 * Math.PI * k) / n
    out[2 * k] = Math.cos(angle)
    out[2 * k + 1] = Math.sin(angle)
  }
  return out
}

function makeHann(n: number): Float32Array {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    out[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)))
  }
  return out
}

export function createSpectrumAnalyzer(
  mono: Float32Array,
  sampleRate: number,
  opts: SpectrumOptions = {}
): SpectrumAnalyzer {
  const fftSize = nextPow2(opts.fftSize ?? 8192)
  // 频率范围校验：0 < freqMin < freqMax ≤ 奈奎斯特（避免对数分桶比值退化）
  const half = sampleRate > 0 ? sampleRate / 2 : 24000
  const fMin = Math.min(Math.max(1, opts.freqMin ?? 30), half - 1)
  let fMax = Math.min(half, opts.freqMax ?? Math.min(16000, half))
  if (fMax <= fMin) fMax = Math.min(half, fMin + 1)
  return {
    sampleRate,
    samples: mono,
    duration: sampleRate > 0 ? mono.length / sampleRate : 0,
    fftSize,
    freqMin: fMin,
    freqMax: fMax,
    window: makeHann(fftSize),
    twiddles: makeTwiddles(fftSize),
    bitRev: makeBitRev(fftSize)
  }
}

/** 就地迭代 FFT（re/im 会被改写） */
function fftInPlace(
  re: Float32Array,
  im: Float32Array,
  bitRev: Int32Array,
  twiddles: Float32Array
): void {
  const n = re.length
  for (let i = 0; i < n; i++) {
    const j = bitRev[i]
    if (i < j) {
      const tr = re[i]
      re[i] = re[j]
      re[j] = tr
      const ti = im[i]
      im[i] = im[j]
      im[j] = ti
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const half = len >> 1
    const step = n / len
    for (let i = 0; i < n; i += len) {
      for (let j = 0; j < half; j++) {
        const k = j * step
        const c = twiddles[2 * k]
        const s = twiddles[2 * k + 1]
        const a = re[i + j + half] * c - im[i + j + half] * s
        const b = re[i + j + half] * s + im[i + j + half] * c
        re[i + j + half] = re[i + j] - a
        im[i + j + half] = im[i + j] - b
        re[i + j] += a
        im[i + j] += b
      }
    }
  }
}

/** 对数分桶：bar i 覆盖 [freqMin*(r)^(i/n), freqMin*(r)^((i+1)/n)]，r = freqMax/freqMin */
function binFreq(analyzer: SpectrumAnalyzer, i: number, barCount: number): [number, number] {
  const ratio = analyzer.freqMax / analyzer.freqMin
  const f1 = analyzer.freqMin * Math.pow(ratio, i / barCount)
  const f2 = analyzer.freqMin * Math.pow(ratio, (i + 1) / barCount)
  return [f1, f2]
}

/**
 * 计算时刻 t 的频谱柱（0–1 高度数组，长度 barCount）。
 * @param bars 复用缓冲（长度须 = barCount），传 null 则新建
 * @param gain 灵敏度增益（越大柱越高越灵敏），默认 4；由布局的 sensitivity 驱动
 */
export function spectrumAt(
  analyzer: SpectrumAnalyzer,
  t: number,
  barCount: number,
  bars: Float32Array | null = null,
  gain = 4
): Float32Array {
  const n = analyzer.fftSize
  const out = bars && bars.length === barCount ? bars : new Float32Array(barCount)
  const sr = analyzer.sampleRate
  const len = analyzer.samples.length
  if (len === 0 || sr <= 0) {
    out.fill(0)
    return out
  }
  const center = Math.min(Math.max(Math.round(t * sr), 0), len - 1)
  const offset = center - n / 2
  const re = new Float32Array(n)
  const im = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const src = offset + i
    if (src >= 0 && src < len) {
      re[i] = analyzer.samples[src] * analyzer.window[i]
    }
  }
  fftInPlace(re, im, analyzer.bitRev, analyzer.twiddles)

  // 幅度谱（跳过 DC），换算到 0–1（相对满幅正弦）
  const norm = n / 2
  const maxK = Math.floor(n / 2) - 1
  for (let i = 0; i < barCount; i++) {
    const [f1, f2] = binFreq(analyzer, i, barCount)
    const k1 = Math.max(1, Math.floor((f1 / sr) * n))
    const k2 = Math.min(maxK, Math.ceil((f2 / sr) * n))
    let sum = 0
    let count = 0
    for (let k = k1; k <= k2; k++) {
      sum += Math.sqrt(re[k] * re[k] + im[k] * im[k])
      count++
    }
    const avg = count > 0 ? sum / count / norm : 0
    // 灵敏度增益 + 软限幅；静音段为 0
    out[i] = Math.min(1, avg * gain)
  }
  return out
}

/** 分带能量（对数感知切分 bass/lowMid/mid/treble），供动效层消费（0.4.0 频段驱动） */
export interface BandEnergy {
  bass: number
  lowMid: number
  mid: number
  treble: number
}

/** 从时刻 t 的频谱计算分带能量（与 spectrumAt 同一 FFT 路径；导出侧每帧调用） */
export function bandEnergiesAt(
  analyzer: SpectrumAnalyzer,
  t: number,
  barCount: number,
  gain = 4
): BandEnergy {
  const bars = spectrumAt(analyzer, t, barCount, null, gain)
  const n = bars.length
  if (n === 0) return { bass: 0, lowMid: 0, mid: 0, treble: 0 }
  // 分带能量口径：段内峰值（软限幅后的幅度谱本身 0–1；峰值口径对"单音集中"与
  // "宽频铺开"都灵敏，且天然适合驱动动效的"强度"语义）
  const bandValue = (s: number, e: number): number => {
    const s0 = Math.max(0, Math.floor(s))
    const e0 = Math.min(n, Math.round(e))
    if (e0 <= s0) return 0
    let peak = 0
    for (let i = s0; i < e0; i++) {
      const v = bars[i]
      if (v > peak) peak = v
    }
    return peak
  }
  // 对数感知：人耳低频分辨率高，等对数段分布更符合听感（频率范围已是对数分桶）
  return {
    bass: bandValue(0, n * 0.25),
    lowMid: bandValue(n * 0.25, n * 0.5),
    mid: bandValue(n * 0.5, n * 0.75),
    treble: bandValue(n * 0.75, n)
  }
}

/** 时间平滑：smoothing ∈ [0,1]，0 = 完全跟随新值；prev 为 null 时返回 target 副本 */
export function smoothBars(
  prev: Float32Array | null,
  target: Float32Array,
  smoothing: number,
  out: Float32Array | null = null
): Float32Array {
  // prev 缺失或长度与 target 不一致（柱数改变）→ 直接取 target，避免索引越界产生 NaN
  if (!prev || prev.length !== target.length) {
    if (out && out.length === target.length) {
      out.set(target)
      return out
    }
    return Float32Array.from(target)
  }
  const res = out && out.length === target.length ? out : new Float32Array(target.length)
  const k = Math.min(Math.max(smoothing, 0), 1)
  for (let i = 0; i < target.length; i++) {
    res[i] = prev[i] * k + target[i] * (1 - k)
  }
  return res
}
