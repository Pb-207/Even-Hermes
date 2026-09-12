export type SttConfig = {
  baseUrl: string
  apiKey: string
  model: string
}

export class SttError extends Error {
  public readonly status: number
  constructor(message: string, status = 0) {
    super(message)
    this.name = 'SttError'
    this.status = status
  }
}

export async function transcribe(cfg: SttConfig, wav: Blob, signal?: AbortSignal): Promise<string> {
  const url = `${cfg.baseUrl}/v1/audio/transcriptions`
  const form = new FormData()
  form.append('file', wav, 'audio.wav')
  form.append('model', cfg.model)

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
      body: form,
      signal,
    })
  } catch (err) {
    throw new SttError(`network: ${(err as Error).message}`)
  }

  if (!res.ok) {
    throw new SttError(`http ${res.status}`, res.status)
  }

  const data = (await res.json()) as { text?: string }
  return data.text ?? ''
}
