import { describe, it, expect } from 'vitest'
import { pcmToWav, PcmRecorder, MIN_USEFUL_BYTES, toPcmBytes } from './audio'

function decodeAscii(buf: ArrayBuffer, offset: number, length: number): string {
  const u8 = new Uint8Array(buf, offset, length)
  return Array.from(u8).map(c => String.fromCharCode(c)).join('')
}

describe('pcmToWav', () => {
  it('writes a correct 44-byte RIFF/WAVE header for 16 kHz mono 16-bit PCM', async () => {
    const pcm = new Uint8Array(32000)        // 1 second of 16 kHz mono 16-bit silence
    const blob = pcmToWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
    const ab = await blob.arrayBuffer()
    const view = new DataView(ab)

    expect(decodeAscii(ab, 0, 4)).toBe('RIFF')
    expect(view.getUint32(4, true)).toBe(36 + pcm.byteLength)
    expect(decodeAscii(ab, 8, 4)).toBe('WAVE')
    expect(decodeAscii(ab, 12, 4)).toBe('fmt ')
    expect(view.getUint32(16, true)).toBe(16)        // fmt chunk size
    expect(view.getUint16(20, true)).toBe(1)         // PCM format code
    expect(view.getUint16(22, true)).toBe(1)         // channels
    expect(view.getUint32(24, true)).toBe(16000)     // sample rate
    expect(view.getUint32(28, true)).toBe(32000)     // byte rate (16000*1*16/8)
    expect(view.getUint16(32, true)).toBe(2)         // block align
    expect(view.getUint16(34, true)).toBe(16)        // bits per sample
    expect(decodeAscii(ab, 36, 4)).toBe('data')
    expect(view.getUint32(40, true)).toBe(pcm.byteLength)
    expect(ab.byteLength).toBe(44 + pcm.byteLength)
  })

  it('preserves the PCM body bytes exactly', async () => {
    const pcm = new Uint8Array([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe])
    const blob = pcmToWav(pcm, { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
    const ab = await blob.arrayBuffer()
    const body = new Uint8Array(ab, 44)
    expect(Array.from(body)).toEqual([0x01, 0x02, 0x03, 0x04, 0xff, 0xfe])
  })

  it('exposes audio/wav MIME type', () => {
    const blob = pcmToWav(new Uint8Array(2), { sampleRate: 16000, channels: 1, bitsPerSample: 16 })
    expect(blob.type).toBe('audio/wav')
  })
})

describe('PcmRecorder', () => {
  it('starts empty', () => {
    const r = new PcmRecorder()
    expect(r.bytes()).toBe(0)
    expect(r.flatten()).toEqual(new Uint8Array(0))
  })

  it('appends multiple chunks and reports total byte count', () => {
    const r = new PcmRecorder()
    r.append(new Uint8Array([1, 2, 3]))
    r.append(new Uint8Array([4, 5]))
    expect(r.bytes()).toBe(5)
  })

  it('flattens chunks in order', () => {
    const r = new PcmRecorder()
    r.append(new Uint8Array([1, 2]))
    r.append(new Uint8Array([3, 4, 5]))
    expect(Array.from(r.flatten())).toEqual([1, 2, 3, 4, 5])
  })

  it('reset() empties the buffer', () => {
    const r = new PcmRecorder()
    r.append(new Uint8Array([1, 2, 3]))
    r.reset()
    expect(r.bytes()).toBe(0)
    expect(r.flatten().length).toBe(0)
  })

  it('exposes MIN_USEFUL_BYTES = 3200 (0.1s of 16 kHz mono 16-bit PCM)', () => {
    expect(MIN_USEFUL_BYTES).toBe(3200)
  })
})

describe('toPcmBytes —— 宿主音频帧归一化', () => {
  // 真机给的是 number[](SDK 文档:Uint8List 经 JSON 后多为 number[] 或 base64)。
  // 早期只用 instanceof Uint8Array 判断,导致真机每一帧都被丢弃(= 录音没声音)。
  it('number[] -> 字节', () => {
    const out = toPcmBytes([0, 1, 255, 128])
    expect(out).toBeInstanceOf(Uint8Array)
    expect(Array.from(out!)).toEqual([0, 1, 255, 128])
  })

  it('Uint8Array 原样返回', () => {
    const src = new Uint8Array([1, 2, 3])
    expect(toPcmBytes(src)).toBe(src)
  })

  it('base64 字符串 -> 字节', () => {
    // "AQID" = [1,2,3]
    expect(Array.from(toPcmBytes('AQID')!)).toEqual([1, 2, 3])
  })

  it('类数组对象 {0:..,1:..} -> 字节', () => {
    expect(Array.from(toPcmBytes({ 0: 7, 1: 8 })!)).toEqual([7, 8])
  })

  it('空值 / 非法输入 -> null(不抛异常)', () => {
    expect(toPcmBytes(undefined)).toBeNull()
    expect(toPcmBytes(null)).toBeNull()
    expect(toPcmBytes([])).toBeNull()
    expect(toPcmBytes('')).toBeNull()
    expect(toPcmBytes({ a: 'x' })).toBeNull()
  })
})
