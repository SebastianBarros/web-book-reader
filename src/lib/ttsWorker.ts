export const WORKER_URL = 'https://web-book-reader-tts.sebastianbarros1995.workers.dev'

export interface CloudVoice {
  name: string
  languageCodes: string[]
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED'
  naturalSampleRateHertz: number
}

export interface SynthesizeOptions {
  text: string
  voice: string
  rate?: number
  pitch?: number
  signal?: AbortSignal
}

export async function synthesize(opts: SynthesizeOptions): Promise<Blob> {
  const res = await fetch(`${WORKER_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: opts.text,
      voice: opts.voice,
      rate: opts.rate ?? 1.0,
      pitch: opts.pitch ?? 0.0,
    }),
    signal: opts.signal,
  })
  if (!res.ok) {
    const message = await res.text().catch(() => res.statusText)
    throw new Error(`TTS worker ${res.status}: ${message.slice(0, 200)}`)
  }
  return await res.blob()
}

export async function listCloudVoices(languageCode?: string): Promise<CloudVoice[]> {
  const url = new URL(`${WORKER_URL}/voices`)
  if (languageCode) url.searchParams.set('languageCode', languageCode)
  const res = await fetch(url.toString())
  if (!res.ok) throw new Error(`Voices worker ${res.status}`)
  const data = (await res.json()) as { voices?: CloudVoice[] }
  return data.voices ?? []
}
