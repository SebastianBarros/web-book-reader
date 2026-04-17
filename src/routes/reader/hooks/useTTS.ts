import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { View } from '@/vendor/foliate-js/view.js'
import type { TTSProvider } from '@/lib/db'
import { synthesize } from '@/lib/ttsWorker'

export type TTSStatus = 'idle' | 'playing' | 'paused' | 'error'
export type SleepMode = 'off' | 'chapter-end'

export interface RelocateDetail {
  reason?: string
  /**
   * Legacy field — kept so existing callers compile. No longer used by the
   * hook; chapter detection is now block-driven via `TTSOptions.resolveChapterForRange`.
   */
  chapterKey?: string | null
}

export interface TTSState {
  supported: boolean
  status: TTSStatus
  /** True while cloud playback is waiting on a block's audio fetch. */
  loading: boolean
  errorMessage: string | null
  sleepMode: SleepMode
  /**
   * Switch sleep mode. Arming is lazy: when you switch to `chapter-end`, the
   * hook captures the current chapter on the next relocate it receives, so
   * callers don't need to pass one. Flip to `'off'` to disarm.
   */
  setSleepMode: (mode: SleepMode) => void
  play: () => void
  pause: () => void
  toggle: () => void
  stop: () => void
  handleRelocate: (detail: RelocateDetail) => void
}

export interface TTSOptions {
  provider: TTSProvider
  voiceURI: string | null
  cloudVoice: string
  rate: number
  pitch: number
  /**
   * Given a DOM Range (typically a block's first-word range), returns the
   * index of the TOC chapter that range belongs to, or null if it can't be
   * resolved. The hook uses this per-block during cloud playback to detect
   * chapter boundaries — more reliable than foliate's tocItem.href tracking
   * (which can freeze on some MOBIs) and finer-grained than the paginator's
   * per-page fraction (which doesn't move when multiple blocks share a page).
   */
  resolveChapterForRange?: (range: Range) => number | null
}

interface ParsedUtterance {
  text: string
  marks: { name: string; offset: number }[]
}

interface CloudQueueItem {
  parsed: ParsedUtterance
  aborter: AbortController
  fetchPromise: Promise<Blob | null>
  url: string | null
  disposed: boolean
  failed: boolean
  failureMessage: string | null
  /**
   * DOM Range of this block's first word, captured at pull-time while
   * foliate's internal `#ranges` map still matched this block. Used to scroll
   * the paginator when we actually begin playing the block.
   */
  firstRange: Range | null
  /**
   * Index of the TOC chapter this block belongs to, resolved via the
   * caller-supplied `resolveChapterForRange` when firstRange was captured.
   * Null when unresolvable (no TOC, range doesn't match any anchor's section,
   * etc.).
   */
  chapterKey: string | null
}

const RETRY_DELAYS_MS = [500, 2000, 5000]

/**
 * Synthesize with exponential-ish retries. Aborts immediately if the signal
 * fires (pause, stop, page-turn). Only throws on abort; all other failures
 * are retried up to RETRY_DELAYS_MS.length times, then re-thrown.
 */
async function synthesizeWithRetry(
  text: string,
  voice: string,
  rate: number,
  signal: AbortSignal,
): Promise<Blob> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (signal.aborted) throw new DOMException('aborted', 'AbortError')
    try {
      return await synthesize({ text, voice, rate, signal })
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      lastErr = err
      const delay = RETRY_DELAYS_MS[attempt]
      if (delay === undefined) break
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay)
        const onAbort = () => {
          clearTimeout(t)
          reject(new DOMException('aborted', 'AbortError'))
        }
        signal.addEventListener('abort', onAbort, { once: true })
      })
    }
  }
  throw lastErr ?? new Error('TTS fetch failed')
}

const CLOUD_PREFETCH_TARGET = 5

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
  let found: string | null = null
  for (const m of marks) {
    if (m.offset <= charIndex) found = m.name
    else break
  }
  return found
}

export function useTTS(view: View | null, opts: TTSOptions): TTSState {
  const browserSupported = typeof window !== 'undefined' && 'speechSynthesis' in window
  const cloudSupported = typeof window !== 'undefined'
  const supported = browserSupported || cloudSupported

  const [status, setStatus] = useState<TTSStatus>('idle')
  const [loading, setLoading] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [sleepMode, setSleepModeRawState] = useState<SleepMode>('off')
  const sleepModeRef = useRef<SleepMode>('off')
  // Single writer so state + ref never diverge.
  const setSleepModeState = useCallback((mode: SleepMode) => {
    sleepModeRef.current = mode
    setSleepModeRawState(mode)
  }, [])

  const statusRef = useRef<TTSStatus>('idle')
  const optsRef = useRef<TTSOptions>(opts)
  const viewRef = useRef<View | null>(view)
  const currentUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const initializedDocRef = useRef<Document | null>(null)
  const selfAdvancePendingRef = useRef(false)
  /** Chapter href that was current when the user armed chapter-end sleep. */
  const armedAtTocHrefRef = useRef<string | null>(null)

  // Cloud-only prefetch state
  const cloudQueueRef = useRef<CloudQueueItem[]>([])
  const cloudSectionExhaustedRef = useRef(false)
  /**
   * Set while pulling a block's SSML to intercept the highlight callback:
   * we fire `setMark('0')` immediately after each `tts.next()` so that
   * foliate's still-fresh `#ranges` map yields this block's first-word Range,
   * which we capture here for later playback scrolling.
   */
  const captureRangeRef = useRef<((range: Range) => void) | null>(null)

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

  const fireMark = useCallback((name: string | null) => {
    if (!name) return
    const v = viewRef.current
    try {
      v?.tts?.setMark(name)
    } catch {
      // ignore
    }
  }, [])

  // Dispose one queue item fully: abort fetch, revoke URL, mark disposed.
  const disposeQueueItem = useCallback((item: CloudQueueItem) => {
    item.disposed = true
    try {
      item.aborter.abort()
    } catch {
      // ignore
    }
    if (item.url) {
      URL.revokeObjectURL(item.url)
      item.url = null
    }
  }, [])

  const clearCloudQueue = useCallback(() => {
    for (const item of cloudQueueRef.current) disposeQueueItem(item)
    cloudQueueRef.current = []
    cloudSectionExhaustedRef.current = false
  }, [disposeQueueItem])

  const ensureTTSInitialized = useCallback(async (v: View): Promise<boolean> => {
    const doc = v.renderer?.getContents?.()?.[0]?.doc as Document | undefined
    if (!doc) return false
    if (v.tts && initializedDocRef.current === doc) return true
    // Our own highlight callback: if a capture closure is installed, hand the
    // range to it (used during prefetch, no scroll); otherwise use foliate's
    // default behaviour of scrolling the paginator to keep pace.
    await v.initTTS('sentence', (range: Range) => {
      const capture = captureRangeRef.current
      if (capture) {
        capture(range.cloneRange())
        return
      }
      try {
        v.renderer?.scrollToAnchor?.(range, true)
      } catch {
        // ignore
      }
    })
    initializedDocRef.current = doc
    return !!v.tts
  }, [])

  /**
   * Capture block N's first-word Range right after pulling its SSML. Must be
   * called while foliate's `#ranges` still matches block N — i.e. immediately
   * after `tts.next()` or `tts.from()` or `tts.start()` returned this block's SSML.
   */
  const captureFirstRange = useCallback(
    (v: View, parsed: ParsedUtterance): Range | null => {
      const firstMarkName = parsed.marks[0]?.name
      if (firstMarkName == null) return null
      let captured: Range | null = null
      captureRangeRef.current = (r) => {
        captured = r
      }
      try {
        v.tts?.setMark(firstMarkName)
      } catch {
        // ignore
      }
      captureRangeRef.current = null
      return captured
    },
    [],
  )

  /**
   * Pull the next block from foliate's TTS iterator and start fetching its audio.
   * Returns true if a new item was enqueued.
   */
  const enqueueNextCloudBlock = useCallback((): boolean => {
    const v = viewRef.current
    if (!v?.tts) return false
    if (cloudSectionExhaustedRef.current) return false
    // Skip empty/whitespace blocks without stopping.
    for (let i = 0; i < 5; i++) {
      const ssml = v.tts.next()
      if (!ssml) {
        cloudSectionExhaustedRef.current = true
        return false
      }
      const parsed = parseSsml(ssml)
      if (!parsed.text.trim()) continue
      // Capture this block's first-word Range BEFORE the next tts.next() call
      // overwrites foliate's internal #ranges map.
      const firstRange = captureFirstRange(v, parsed)
      const chapterIdx =
        firstRange && optsRef.current.resolveChapterForRange
          ? optsRef.current.resolveChapterForRange(firstRange)
          : null
      const aborter = new AbortController()
      const item: CloudQueueItem = {
        parsed,
        aborter,
        fetchPromise: Promise.resolve(null),
        url: null,
        disposed: false,
        failed: false,
        failureMessage: null,
        firstRange,
        chapterKey: chapterIdx !== null && chapterIdx >= 0 ? `ch:${chapterIdx}` : null,
      }
      item.fetchPromise = synthesizeWithRetry(
        parsed.text,
        optsRef.current.cloudVoice,
        optsRef.current.rate,
        aborter.signal,
      )
        .then((blob) => {
          if (item.disposed) return null
          item.url = URL.createObjectURL(blob)
          return blob
        })
        .catch((err) => {
          if ((err as Error)?.name === 'AbortError') return null
          console.error('Prefetch failed after retries', err)
          item.failed = true
          item.failureMessage = err instanceof Error ? err.message : String(err)
          return null
        })
      cloudQueueRef.current.push(item)
      return true
    }
    return false
  }, [captureFirstRange])

  const topUpCloudQueue = useCallback(() => {
    while (cloudQueueRef.current.length < CLOUD_PREFETCH_TARGET && enqueueNextCloudBlock()) {
      // keep going
    }
  }, [enqueueNextCloudBlock])

  /** Push a pre-chosen SSML (e.g. from tts.from(range) or tts.start()) as queue[0]. */
  const primeCloudQueue = useCallback(
    (firstSsml: string | undefined): boolean => {
      if (!firstSsml) return false
      const v = viewRef.current
      if (!v) return false
      const parsed = parseSsml(firstSsml)
      if (!parsed.text.trim()) return false
      const firstRange = captureFirstRange(v, parsed)
      const chapterIdx =
        firstRange && optsRef.current.resolveChapterForRange
          ? optsRef.current.resolveChapterForRange(firstRange)
          : null
      const aborter = new AbortController()
      const item: CloudQueueItem = {
        parsed,
        aborter,
        fetchPromise: Promise.resolve(null),
        url: null,
        disposed: false,
        failed: false,
        failureMessage: null,
        firstRange,
        chapterKey: chapterIdx !== null && chapterIdx >= 0 ? `ch:${chapterIdx}` : null,
      }
      item.fetchPromise = synthesizeWithRetry(
        parsed.text,
        optsRef.current.cloudVoice,
        optsRef.current.rate,
        aborter.signal,
      )
        .then((blob) => {
          if (item.disposed) return null
          item.url = URL.createObjectURL(blob)
          return blob
        })
        .catch((err) => {
          if ((err as Error)?.name === 'AbortError') return null
          console.error('Prefetch failed after retries', err)
          item.failed = true
          item.failureMessage = err instanceof Error ? err.message : String(err)
          return null
        })
      cloudQueueRef.current.push(item)
      return true
    },
    [captureFirstRange],
  )

  /**
   * Advance to the next spine section (used when the current section's TTS
   * iterator is exhausted). Returns true on success.
   */
  const advanceSection = useCallback(async (): Promise<boolean> => {
    const v = viewRef.current
    if (!v) return false
    selfAdvancePendingRef.current = true
    try {
      await v.next()
    } catch (err) {
      console.error('TTS: failed to advance section', err)
      selfAdvancePendingRef.current = false
      return false
    }
    // Wait a tick for the new doc to mount.
    await new Promise((r) => setTimeout(r, 150))
    const nextView = viewRef.current
    if (!nextView) return false
    initializedDocRef.current = null
    ;(nextView as { tts?: unknown }).tts = undefined
    return await ensureTTSInitialized(nextView)
  }, [ensureTTSInitialized])

  // Cancel current audio playback without clearing queued prefetched items.
  const pauseAudioOnly = useCallback(() => {
    // Browser: cancel() is the only reliable pause on Chromium.
    const u = currentUtteranceRef.current
    if (u) {
      u.onend = null
      u.onerror = null
      u.onstart = null
      u.onboundary = null
    }
    currentUtteranceRef.current = null
    if (browserSupported) {
      try {
        window.speechSynthesis.cancel()
      } catch {
        // ignore
      }
    }
    // Cloud: pause the audio element; keep queue and blob URLs intact.
    const audio = currentAudioRef.current
    if (audio) {
      try {
        audio.pause()
      } catch {
        // ignore
      }
    }
  }, [browserSupported])

  // Full cancel: stop playback, nuke queued fetches, reset audio element.
  const cancelEverything = useCallback(() => {
    pauseAudioOnly()
    clearCloudQueue()
    const audio = currentAudioRef.current
    if (audio) {
      audio.onplay = null
      audio.onended = null
      audio.onerror = null
      try {
        audio.removeAttribute('src')
        audio.load()
      } catch {
        // ignore
      }
    }
  }, [pauseAudioOnly, clearCloudQueue])

  // ------------------------------------------------------------------
  // Cloud playback loop
  // ------------------------------------------------------------------

  const playCloudHeadRef = useRef<() => Promise<void>>(async () => {})

  const playCloudHead = useCallback(async (): Promise<void> => {
    if (statusRef.current !== 'playing') return

    // If queue empty, try to advance section and prime.
    if (cloudQueueRef.current.length === 0) {
      if (!cloudSectionExhaustedRef.current) {
        updateStatus('idle')
        return
      }
      cloudSectionExhaustedRef.current = false
      const ok = await advanceSection()
      if (!ok) {
        updateStatus('idle')
        return
      }
      if (statusRef.current !== 'playing') return
      const v = viewRef.current
      if (!v?.tts) {
        updateStatus('idle')
        return
      }
      if (!primeCloudQueue(v.tts.start())) {
        updateStatus('idle')
        return
      }
      topUpCloudQueue()
    }

    const head = cloudQueueRef.current[0]
    if (!head) {
      updateStatus('idle')
      return
    }

    // Show loading if we're still waiting on this block's fetch (first play,
    // or our playback caught up to a slow network fetch).
    if (!head.url && !head.failed) setLoading(true)

    // Wait for this item's audio to finish fetching (often already done thanks
    // to prefetch — this resolves immediately if so).
    await head.fetchPromise
    if (head.disposed) return
    if (statusRef.current !== 'playing') return
    setLoading(false)

    if (head.failed || !head.url) {
      // Permanent failure after retries — stop playback and tell the user.
      setErrorMessage(
        `Could not fetch audio for this paragraph${head.failureMessage ? `: ${head.failureMessage}` : '.'}`,
      )
      updateStatus('error')
      return
    }

    let audio = currentAudioRef.current
    if (!audio) {
      audio = new Audio()
      currentAudioRef.current = audio
    }
    const myAudio = audio
    audio.src = head.url
    audio.playbackRate = 1.0 // rate was already baked in by Google

    // Scroll the paginator to this block's start BEFORE audio begins so the
    // page is already visible. Uses the range we captured at pull-time; we
    // deliberately avoid tts.setMark here because foliate's #ranges map no
    // longer matches this block after prefetching.
    if (head.firstRange) {
      try {
        viewRef.current?.renderer?.scrollToAnchor?.(head.firstRange, true)
      } catch {
        // ignore
      }
    }

    audio.onplay = () => {
      if (currentAudioRef.current !== myAudio) return
      if (statusRef.current !== 'playing') return
      setLoading(false)

      // Chapter-end sleep check — fires per-block, driven by the block's
      // resolved chapterKey rather than foliate's paginator fraction.
      if (sleepModeRef.current === 'chapter-end' && head.chapterKey !== null) {
        if (armedAtTocHrefRef.current === null) {
          armedAtTocHrefRef.current = head.chapterKey
        } else if (head.chapterKey !== armedAtTocHrefRef.current) {
          armedAtTocHrefRef.current = null
          setSleepModeState('off')
          updateStatus('idle')
          setLoading(false)
          cancelEverything()
          initializedDocRef.current = null
          try {
            toast.message('Audiobook paused — end of chapter reached.')
          } catch {
            // ignore
          }
        }
      }
    }
    audio.onended = () => {
      if (currentAudioRef.current !== myAudio) return
      if (statusRef.current !== 'playing') return
      // Consume head
      head.disposed = true
      if (head.url) URL.revokeObjectURL(head.url)
      head.url = null
      cloudQueueRef.current.shift()
      topUpCloudQueue()
      void playCloudHeadRef.current()
    }
    audio.onerror = () => {
      if (currentAudioRef.current !== myAudio) return
      setErrorMessage('Audio playback failed')
      updateStatus('error')
    }

    try {
      await audio.play()
    } catch (err) {
      const name = (err as Error)?.name
      if (name === 'AbortError' || name === 'NotAllowedError') return
      console.warn('audio.play rejected', err)
    }
  }, [advanceSection, primeCloudQueue, topUpCloudQueue, updateStatus])

  useEffect(() => {
    playCloudHeadRef.current = playCloudHead
  }, [playCloudHead])

  // ------------------------------------------------------------------
  // Browser playback loop (serial — no prefetch needed, synthesis is local)
  // ------------------------------------------------------------------

  const advanceBrowserRef = useRef<() => Promise<void>>(async () => {})

  const speakBrowser = useCallback(
    (parsed: ParsedUtterance): boolean => {
      if (!browserSupported) return false

      const utterance = new SpeechSynthesisUtterance(parsed.text)
      const { voiceURI, rate, pitch } = optsRef.current
      if (voiceURI) {
        const match = window.speechSynthesis.getVoices().find((v) => v.voiceURI === voiceURI)
        if (match) utterance.voice = match
      }
      utterance.rate = rate
      utterance.pitch = pitch

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
        if (currentUtteranceRef.current !== utterance) return
        if (statusRef.current !== 'playing') return
        currentUtteranceRef.current = null
        void advanceBrowserRef.current()
      }
      utterance.onerror = (ev) => {
        if (currentUtteranceRef.current !== utterance) return
        currentUtteranceRef.current = null
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
    [browserSupported, fireMark, updateStatus],
  )

  const advanceBrowser = useCallback(async (): Promise<void> => {
    const v = viewRef.current
    if (!v || !v.tts) return
    if (statusRef.current !== 'playing') return

    const ssml = v.tts.next()
    if (ssml) {
      speakBrowser(parseSsml(ssml))
      return
    }

    const ok = await advanceSection()
    if (!ok) {
      updateStatus('idle')
      return
    }
    if (statusRef.current !== 'playing') return
    const v2 = viewRef.current
    if (!v2?.tts) {
      updateStatus('idle')
      return
    }
    const firstSsml = v2.tts.start()
    if (!firstSsml) {
      updateStatus('idle')
      return
    }
    speakBrowser(parseSsml(firstSsml))
  }, [advanceSection, speakBrowser, updateStatus])

  useEffect(() => {
    advanceBrowserRef.current = advanceBrowser
  }, [advanceBrowser])

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------

  const play = useCallback(async () => {
    if (!supported) return
    const v = viewRef.current
    if (!v) return
    setErrorMessage(null)

    const provider = optsRef.current.provider
    const wasPaused = statusRef.current === 'paused'
    const docChanged = initializedDocRef.current !== (v.renderer?.getContents?.()?.[0]?.doc ?? null)

    // Cloud resume from pause: just resume the audio element if possible.
    if (provider === 'cloud' && wasPaused && !docChanged && currentAudioRef.current?.src) {
      updateStatus('playing')
      try {
        await currentAudioRef.current.play()
        return
      } catch {
        // fall through to full re-init
      }
    }

    const ok = await ensureTTSInitialized(v)
    if (!ok || !v.tts) {
      setErrorMessage('Could not initialize speech for this page.')
      updateStatus('error')
      return
    }

    updateStatus('playing')

    if (provider === 'cloud') {
      // Fresh cloud start: nuke any stale queue, prime first block, fill queue, play.
      clearCloudQueue()
      let firstSsml: string | undefined
      if (wasPaused && !docChanged) {
        firstSsml = v.tts.resume()
      } else {
        const currentRange = v.lastLocation?.range
        firstSsml = currentRange ? v.tts.from(currentRange) : v.tts.start()
      }
      if (!primeCloudQueue(firstSsml)) {
        updateStatus('idle')
        return
      }
      topUpCloudQueue()
      void playCloudHeadRef.current()
      return
    }

    // Browser path
    let ssml: string | undefined
    if (wasPaused && !docChanged) {
      ssml = v.tts.resume()
    } else {
      const currentRange = v.lastLocation?.range
      ssml = currentRange ? v.tts.from(currentRange) : v.tts.start()
    }
    if (!ssml) {
      void advanceBrowserRef.current()
      return
    }
    if (!speakBrowser(parseSsml(ssml))) {
      void advanceBrowserRef.current()
    }
  }, [
    clearCloudQueue,
    ensureTTSInitialized,
    primeCloudQueue,
    speakBrowser,
    supported,
    topUpCloudQueue,
    updateStatus,
  ])

  const pause = useCallback(() => {
    if (statusRef.current !== 'playing') return
    updateStatus('paused')
    setLoading(false)
    pauseAudioOnly()
    // NOTE: we intentionally do NOT clear the cloud queue on pause —
    // prefetched blocks stay hot for an instant resume.
  }, [pauseAudioOnly, updateStatus])

  const stop = useCallback(() => {
    updateStatus('idle')
    setLoading(false)
    cancelEverything()
    initializedDocRef.current = null
    setSleepModeState('off')
    armedAtTocHrefRef.current = null
  }, [cancelEverything, updateStatus])

  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') pause()
    else void play()
  }, [pause, play])

  const setSleepMode = useCallback(
    (mode: SleepMode) => {
      setSleepModeState(mode)
      // Arming is lazy — the first relocate after we enter chapter-end mode
      // captures the armed chapter. Flipping off clears the armed value.
      if (mode === 'off') armedAtTocHrefRef.current = null
    },
    [setSleepModeState],
  )

  const handleRelocate = useCallback(
    (detail: RelocateDetail) => {
      const reason = detail.reason

      // Reason-based cancel (user page-turn / navigation / selection).
      // Chapter-end detection lives in `audio.onplay` now, block-by-block,
      // since the paginator's fraction is too coarse for reliable chapter
      // detection when multiple blocks share a page.
      if (selfAdvancePendingRef.current) {
        selfAdvancePendingRef.current = false
        return
      }
      if (statusRef.current !== 'playing' && statusRef.current !== 'paused') return
      if (reason === 'page' || reason === 'navigation' || reason === 'selection') {
        updateStatus('idle')
        setLoading(false)
        cancelEverything()
        initializedDocRef.current = null
        setSleepModeState('off')
        armedAtTocHrefRef.current = null
      }
    },
    [cancelEverything, setSleepModeState, updateStatus],
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
        cancelEverything()
        updateStatus('playing')
        const provider = optsRef.current.provider
        const ssml = v.tts.from(range)
        if (!ssml) return
        if (provider === 'cloud') {
          if (!primeCloudQueue(ssml)) {
            updateStatus('idle')
            return
          }
          topUpCloudQueue()
          void playCloudHeadRef.current()
        } else {
          if (!speakBrowser(parseSsml(ssml))) void advanceBrowserRef.current()
        }
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
  }, [
    view,
    supported,
    ensureTTSInitialized,
    cancelEverything,
    updateStatus,
    primeCloudQueue,
    topUpCloudQueue,
    speakBrowser,
  ])

  useEffect(() => {
    return () => {
      updateStatus('idle')
      cancelEverything()
      initializedDocRef.current = null
    }
  }, [cancelEverything, updateStatus])

  useEffect(() => {
    if (!view) {
      updateStatus('idle')
      cancelEverything()
      initializedDocRef.current = null
    }
  }, [view, cancelEverything, updateStatus])

  return {
    supported,
    status,
    loading,
    errorMessage,
    sleepMode,
    setSleepMode,
    play: () => {
      void play()
    },
    pause,
    toggle,
    stop,
    handleRelocate,
  }
}
