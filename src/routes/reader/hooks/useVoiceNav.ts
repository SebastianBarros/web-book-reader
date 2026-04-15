import { useCallback, useEffect, useRef, useState } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'

const NEXT_WORDS = ['next']
const PREV_WORDS = ['back']

export type VoiceNavStatus = 'idle' | 'listening' | 'denied' | 'error'

export interface VoiceNavState {
  supported: boolean
  status: VoiceNavStatus
  errorMessage: string | null
}

function getRecognitionCtor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function containsKeyword(transcript: string, words: string[]): boolean {
  const normalized = transcript.toLowerCase().trim()
  if (!normalized) return false
  const tokens = normalized.split(/\s+/)
  return tokens.some((t) => words.includes(t))
}

export function useVoiceNav(view: View | null, enabled: boolean): VoiceNavState {
  const supported = getRecognitionCtor() !== null
  const [status, setStatus] = useState<VoiceNavStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  const shouldRunRef = useRef(false)
  const handledResultIndexRef = useRef(-1)
  const viewRef = useRef<View | null>(view)

  useEffect(() => {
    viewRef.current = view
  }, [view])

  const handleResult = useCallback((ev: SpeechRecognitionEvent) => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      // Each `i` is one utterance. The recognizer keeps re-emitting updates
      // (interim → final) for the same `i`, so once we've acted on it we
      // ignore every later update of that same utterance.
      if (i <= handledResultIndexRef.current) continue
      const result = ev.results[i]
      let action: 'next' | 'prev' | null = null
      for (let a = 0; a < result.length; a++) {
        const transcript = result[a]?.transcript ?? ''
        if (containsKeyword(transcript, NEXT_WORDS)) {
          action = 'next'
          break
        }
        if (containsKeyword(transcript, PREV_WORDS)) {
          action = 'prev'
          break
        }
      }
      if (action) {
        handledResultIndexRef.current = i
        if (action === 'next') void viewRef.current?.goRight()
        else void viewRef.current?.goLeft()
      }
    }
  }, [])

  useEffect(() => {
    if (!enabled || !supported) {
      shouldRunRef.current = false
      recognitionRef.current?.abort()
      recognitionRef.current = null
      setStatus('idle')
      setErrorMessage(null)
      return
    }

    const Ctor = getRecognitionCtor()
    if (!Ctor) return

    const recognition = new Ctor()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = navigator.language || 'en-US'
    recognition.maxAlternatives = 3

    recognition.onresult = handleResult
    recognition.onstart = () => {
      handledResultIndexRef.current = -1
      setStatus('listening')
    }
    recognition.onerror = (ev) => {
      if (ev.error === 'not-allowed' || ev.error === 'service-not-allowed') {
        shouldRunRef.current = false
        setStatus('denied')
        setErrorMessage('Microphone permission was denied.')
      } else if (ev.error === 'no-speech' || ev.error === 'aborted') {
        // expected in continuous mode; let onend restart us
      } else {
        setStatus('error')
        setErrorMessage(ev.error)
      }
    }
    recognition.onend = () => {
      if (shouldRunRef.current) {
        try {
          recognition.start()
        } catch {
          // ignore — restart will be retried on next tick if needed
        }
      } else {
        setStatus('idle')
      }
    }

    recognitionRef.current = recognition
    shouldRunRef.current = true
    setErrorMessage(null)
    try {
      recognition.start()
    } catch (err) {
      setStatus('error')
      setErrorMessage(err instanceof Error ? err.message : String(err))
    }

    return () => {
      shouldRunRef.current = false
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onstart = null
      try {
        recognition.abort()
      } catch {
        // ignore
      }
      recognitionRef.current = null
    }
  }, [enabled, supported, handleResult])

  return { supported, status, errorMessage }
}
