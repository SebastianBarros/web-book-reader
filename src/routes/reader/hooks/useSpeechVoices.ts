import { useEffect, useState } from 'react'

export interface BrowserVoice {
  voiceURI: string
  name: string
  lang: string
  localService: boolean
  default: boolean
}

function listVoices(): BrowserVoice[] {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return []
  return window.speechSynthesis.getVoices().map((v) => ({
    voiceURI: v.voiceURI,
    name: v.name,
    lang: v.lang,
    localService: v.localService,
    default: v.default,
  }))
}

export function useSpeechVoices(): BrowserVoice[] {
  const [voices, setVoices] = useState<BrowserVoice[]>(() => listVoices())

  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const refresh = () => setVoices(listVoices())
    refresh()
    window.speechSynthesis.addEventListener?.('voiceschanged', refresh)
    return () => {
      window.speechSynthesis.removeEventListener?.('voiceschanged', refresh)
    }
  }, [])

  return voices
}
