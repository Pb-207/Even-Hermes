export type PcmFormat = {
  sampleRate: number
  channels: number
  bitsPerSample: number
}

export function pcmToWav(pcm: Uint8Array, fmt: PcmFormat): Blob {
  const { sampleRate, channels, bitsPerSample } = fmt
  const byteRate = (sampleRate * channels * bitsPerSample) / 8
  const blockAlign = (channels * bitsPerSample) / 8
  const dataSize = pcm.byteLength
  const headerSize = 44
  const total = headerSize + dataSize

  const buf = new ArrayBuffer(total)
  const view = new DataView(buf)
  let off = 0

  const writeAscii = (s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off++, s.charCodeAt(i))
  }
  const u32 = (n: number) => { view.setUint32(off, n, true); off += 4 }
  const u16 = (n: number) => { view.setUint16(off, n, true); off += 2 }

  writeAscii('RIFF')
  u32(36 + dataSize)
  writeAscii('WAVE')
  writeAscii('fmt ')
  u32(16)
  u16(1)
  u16(channels)
  u32(sampleRate)
  u32(byteRate)
  u16(blockAlign)
  u16(bitsPerSample)
  writeAscii('data')
  u32(dataSize)

  new Uint8Array(buf, headerSize).set(pcm)

  return new Blob([buf], { type: 'audio/wav' })
}

// 16 kHz * 0.1 s * 2 bytes/sample = 3200 bytes; below this we treat as silence.
export const MIN_USEFUL_BYTES = 3200

export class PcmRecorder {
  private chunks: Uint8Array[] = []
  private total = 0

  reset(): void {
    this.chunks = []
    this.total = 0
  }

  append(chunk: Uint8Array): void {
    this.chunks.push(chunk)
    this.total += chunk.byteLength
  }

  bytes(): number {
    return this.total
  }

  flatten(): Uint8Array {
    const out = new Uint8Array(this.total)
    let off = 0
    for (const c of this.chunks) {
      out.set(c, off)
      off += c.byteLength
    }
    return out
  }
}

/**
 * 归一化宿主送来的音频帧。
 *
 * SDK 文档写明:`audioPcm` 是宿主侧的 `Uint8List`,经 JSON 序列化后**多为 `number[]`
 * 或 base64 字符串**(见 SDK 的 EvenHubEvent 注释)。真机上实测不是 `Uint8Array`,
 * 早先只用 `instanceof Uint8Array` 判断会把**每一帧都丢掉**,表现为"录音没有任何声音"。
 * 这里把三种形态统一成字节。
 */
export function toPcmBytes(raw: unknown): Uint8Array | null {
  if (raw instanceof Uint8Array) return raw
  if (Array.isArray(raw)) {
    if (!raw.length) return null
    return Uint8Array.from(raw as number[])
  }
  if (typeof raw === 'string') {
    if (!raw) return null
    try {
      const bin = atob(raw)
      const out = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
      return out
    } catch {
      return null
    }
  }
  if (raw && typeof raw === 'object') {
    const vals = Object.values(raw as Record<string, unknown>)
    if (vals.length && vals.every((v) => typeof v === 'number')) {
      return Uint8Array.from(vals as number[])
    }
  }
  return null
}
