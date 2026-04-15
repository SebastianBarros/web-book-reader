import { useCallback, useEffect, useRef, useState } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'

export type TTSStatus = 'idle' | 'playing' | 'paused' | 'error'

export interface TTSState {
  supported: boolean
  status: TTSStatus
  errorMessage: string | null
  play: () => void
  pause: () => void
  toggle: () => void
  stop: () => void
  /**
   * Call when a relocate event happens, passing its `reason`.
   * Cancels TTS when the user manually turned the page or navigated,
   * but ignores events triggered by TTS's own section-advance.
   */
  handleRelocate: (reason: string | undefined) => void
}

export interface TTSOptions {
  voiceURI: string | null
  rate: number
  pitch: number
}

interface ParsedUtterance {
  text: string
  /** Character offset (into `text`) at which each SSML <mark> appears. */
  marks: { name: string; offset: number }[]
}

function parseSsml(ssml: string | undefined | null): ParsedUtterance {
  if (!ssml) return { text: '', marks: [] }
  try {
    const doc = new DOMParser().parseFromString(ssml, 'application/xml')
    const root = doc.documentElement
    const marks: { name: string; offset: number }[] = []
    let text = ''
    const visit = (node: Node) => {
      if (node.nodeType === Node.TEXT_NODE) {
        text += node.textContent ?? ''
        return
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return
      const el = node as Element
      if (el.localName === 'mark') {
        const name = el.getAttribute('name')
        if (name != null) marks.push({ name, offset: text.length })
        return
      }
      if (el.localName === 'break') {
        // Preserve the pause as a period so prosody stays natural.
        text += '. '
        return
      }
      for (let c = el.firstChild; c; c = c.nextSibling) visit(c)
    }
    visit(root)
    return { text, marks }
  } catch {
    return { text: '', marks: [] }
  }
}

function findMarkAt(marks: { name: string; offset: number }[], charIndex: number): string | null {
  // Last mark whose offset <= charIndex.
  let found: string | null = null
  for (const m of marks) {
    if (m.offset <= charIndex) found = m.name
    else break
  }
  return found
}

export function useTTS(view: View | null, opts: TTSOptions): TTSState {
  const supported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const [status, setStatus] = useState<TTSStatus>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const statusRef = useRef<TTSStatus>('idle')
  const optsRef = useRef<TTSOptions>(opts)
  const viewRef = useRef<View | null>(view)
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const initializedDocRef = useRef<Document | null>(null)
  const selfAdvancePendingRef = useRef(false)

  useEffect(() => {
    optsRef.current = opts
  }, [opts])

  useEffect(() => {
    viewRef.current = view
  }, [view])

  const updateStatus = useCallback((next: TTSStatus) => {
    statusRef.current = next
    setStatus(next)
  }, [])

  const cancelSpeech = useCallback(() => {
    if (!supported) return
    const u = currentUtteranceRef.current
    if (u) {
      u.onend = null
      u.onerror = null
      u.onstart = null
    }
    currentUtteranceRef.current = null
    try {
      window.speechSynthesis.cancel()
    } catch {
      // ignore
    }
  }, [supported])

  const ensureTTSInitialized = useCallback(async (v: View): Promise<boolean> => {
    const doc = v.renderer?.getContents?.()?.[0]?.doc as Document | undefined
    if (!doc) return false
    if (v.tts && initializedDocRef.current === doc) return true
    await v.initTTS('sentence')
    initializedDocRef.current = doc
    return !!v.tts
  }, [])

  // Forward-declared so speakSsml can reference it.
  const advanceRef = useRef<() => Promise<void>>(async () => {})

  const speakSsml = useCallback(
    (ssml: string | undefined | null): boolean => {
      if (!supported) return false
      const parsed = parseSsml(ssml)
      const text = parsed.text.trim()
      if (!text) return false

      const utterance = new SpeechSynthesisUtterance(parsed.text)
      const { voiceURI, rate, pitch } = optsRef.current
      if (voiceURI) {
        const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
        if (match) utterance.voice = match
      }
      utterance.rate = rate
      utterance.pitch = pitch

      const fireMark = (name: string | null) => {
        if (!name) return
        const v = viewRef.current
        try {
          v?.tts?.setMark(name)
        } catch {
          // ignore — setMark failures shouldn't kill playback
        }
      }

      utterance.onstart = () => {
        if (currentUtteranceRef.current !== utterance) return
        fireMark(parsed.marks[0]?.name ?? null)
      }
      utterance.onboundary = (ev) => {
        if (currentUtteranceRef.current !== utterance) return
        if (ev.name && ev.name !== 'word') return
        fireMark(findMarkAt(parsed.marks, ev.charIndex))
      }
      utterance.onend = () => {
        // Only advance if this utterance is still the "current" one and we're still playing.
        if (currentUtteranceRef.current !== utterance) return
        if (statusRef.current !== 'playing') return
        currentUtteranceRef.current = null
        void advanceRef.current()
      }
      utterance.onerror = (ev) => {
        if (currentUtteranceRef.current !== utterance) return
        currentUtteranceRef.current = null
        // Chromium fires an 'interrupted' / 'canceled' error when we call cancel().
        // That's our normal pause path — don't surface it as an error.
        const reason = ev.error
        if (reason === 'interrupted' || reason === 'canceled') return
        setErrorMessage(reason || 'Speech synthesis error')
        updateStatus('error')
      }

      currentUtteranceRef.current = utterance
      try {
        window.speechSynthesis.speak(utterance)
        return true
      } catch (err) {
        setErrorMessage(err instanceof Error ? err.message : String(err))
        updateStatus('error')
        return false
      }
    },
    [supported, updateStatus],
  )

  const advance = useCallback(async (): Promise<void> => {
    const v = viewRef.current
    if (!v || !v.tts) return
    if (statusRef.current !== 'playing') return

    const ssml = v.tts.next()
    if (ssml) {
      speakSsml(ssml)
      return
    }

    // End of section — move to next spine section, then re-init and continue.
    selfAdvancePendingRef.current = true
    try {
      await v.next()
    } catch (err) {
      console.error('TTS: failed to advance section', err)
      selfAdvancePendingRef.current = false
      updateStatus('idle')
      return
    }
    if (statusRef.current !== 'playing') return

    // Wait a tick for the renderer to mount the new doc.
    await new Promise((r) => setTimeout(r, 150))
    if (statusRef.current !== 'playing') return

    const nextView = viewRef.current
    if (!nextView) return
    initializedDocRef.current = null
    // Force re-init on the new section.
    ;(nextView as { tts?: unknown }).tts = undefined
    const ok = await ensureTTSInitialized(nextView)
    if (!ok || !nextView.tts) {
      updateStatus('idle')
      return
    }
    const firstSsml = nextView.tts.start()
    if (firstSsml) speakSsml(firstSsml)
    else updateStatus('idle')
  }, [ensureTTSInitialized, speakSsml, updateStatus])

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  const play = useCallback(async () => {
    if (!supported) return
    const v = viewRef.current
    if (!v) return
    setErrorMessage(null)

    const wasPaused = statusRef.current === 'paused'
    const docChanged = initializedDocRef.current !== (v.renderer?.getContents?.()?.[0]?.doc ?? null)

    const ok = await ensureTTSInitialized(v)
    if (!ok || !v.tts) {
      setErrorMessage('Could not initialize speech for this page.')
      updateStatus('error')
      return
    }

    updateStatus('playing')
    let ssml: string | undefined
    if (wasPaused && !docChanged) {
      ssml = v.tts.resume()
    } else {
      // Begin at the user's current visible position, not the section start.
      const currentRange = v.lastLocation?.range
      ssml = currentRange ? v.tts.from(currentRange) : v.tts.start()
    }
    if (!ssml || !speakSsml(ssml)) {
      // Nothing to speak on this page — try advancing once.
      void advance()
    }
  }, [advance, ensureTTSInitialized, speakSsml, supported, updateStatus])

  const pause = useCallback(() => {
    if (!supported) return
    if (statusRef.current !== 'playing') return
    updateStatus('paused')
    cancelSpeech()
  }, [cancelSpeech, supported, updateStatus])

  const stop = useCallback(() => {
    if (!supported) return
    updateStatus('idle')
    cancelSpeech()
    initializedDocRef.current = null
  }, [cancelSpeech, supported, updateStatus])

  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') pause()
    else void play()
  }, [pause, play])

  const handleRelocate = useCallback(
    (reason: string | undefined) => {
      if (selfAdvancePendingRef.current) {
        // Consume the relocate our own advance triggered.
        selfAdvancePendingRef.current = false
        return
      }
      if (statusRef.current !== 'playing' && statusRef.current !== 'paused') return
      if (reason === 'page' || reason === 'navigation' || reason === 'selection') {
        updateStatus('idle')
        cancelSpeech()
        initializedDocRef.current = null
      }
    },
    [cancelSpeech, updateStatus],
  )

  // Click-to-jump: tapping any paragraph-level block starts TTS from it.
  useEffect(() => {
    if (!supported || !view) return
    let attachedDoc: Document | null = null

    const PARAGRAPH_SELECTOR =
      'p, li, blockquote, h1, h2, h3, h4, h5, h6, dd, dt, pre, figcaption'

    const onClick = (ev: Event) => {
      const mouseEv = ev as MouseEvent
      if (mouseEv.defaultPrevented) return
      const target = mouseEv.target as Element | null
      if (!target) return
      // Don't hijack link clicks — foliate handles those.
      if (target.closest('a[href]')) return
      const block = target.closest(PARAGRAPH_SELECTOR) as HTMLElement | null
      if (!block || !attachedDoc) return
      if (!(block.textContent ?? '').trim()) return

      const range = attachedDoc.createRange()
      range.selectNodeContents(block)

      const v = viewRef.current
      if (!v) return
      ;(async () => {
        const ok = await ensureTTSInitialized(v)
        if (!ok || !v.tts) return
        cancelSpeech()
        updateStatus('playing')
        const ssml = v.tts.from(range)
        if (ssml && !speakSsml(ssml)) void advanceRef.current()
        else if (!ssml) void advanceRef.current()
      })().catch((err) => console.error('TTS click-to-jump failed', err))
    }

    const attach = (doc: Document) => {
      if (attachedDoc === doc) return
      if (attachedDoc) attachedDoc.removeEventListener('click', onClick)
      attachedDoc = doc
      doc.addEventListener('click', onClick)
    }

    const onLoad = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { doc?: Document } | undefined
      if (detail?.doc) attach(detail.doc)
    }

    view.addEventListener('load', onLoad)
    const existing = view.renderer?.getContents?.()?.[0]?.doc
    if (existing) attach(existing)

    return () => {
      view.removeEventListener('load', onLoad)
      if (attachedDoc) attachedDoc.removeEventListener('click', onClick)
    }
  }, [view, supported, ensureTTSInitialized, cancelSpeech, updateStatus, speakSsml])

  // Cleanup on unmount and stop when view changes (different book / reader unmount).
  useEffect(() => {
    return () => {
      updateStatus('idle')
      cancelSpeech()
      initializedDocRef.current = null
    }
  }, [cancelSpeech, updateStatus])

  useEffect(() => {
    if (!view) {
      updateStatus('idle')
      cancelSpeech()
      initializedDocRef.current = null
    }
  }, [view, cancelSpeech, updateStatus])

  return {
    supported,
    status,
    errorMessage,
    play: () => {
      void play()
    },
    pause,
    toggle,
    stop,
    handleRelocate,
  }
}
