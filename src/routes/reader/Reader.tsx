import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getBook, getProgress, type BookRecord } from '@/lib/db'
import { setLastBookId } from '@/lib/storage'
import { useFoliateView } from './hooks/useFoliateView'
import { useReadingProgress } from './hooks/useReadingProgress'
import { useLayoutSettings } from './hooks/useLayoutSettings'
import { useReadingSpeed } from './hooks/useReadingSpeed'
import { useToc } from './hooks/useToc'
import { useTTS } from './hooks/useTTS'
import { useVoiceNav } from './hooks/useVoiceNav'
import { ReaderTopbar } from './components/ReaderTopbar'
import { ReaderNav } from './components/ReaderNav'
import { TocSheet } from './components/TocSheet'
import { SettingsSheet } from './components/SettingsSheet'

export default function Reader() {
  const { bookId } = useParams<{ bookId: string }>()
  const navigate = useNavigate()
  const containerRef = useRef<HTMLDivElement>(null)

  const [book, setBook] = useState<BookRecord | null>(null)
  const [initialLocator, setInitialLocator] = useState<string | null | undefined>(undefined)
  const [tocOpen, setTocOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    if (!bookId) return
    let cancelled = false
    ;(async () => {
      const rec = await getBook(bookId)
      if (cancelled) return
      if (!rec) {
        toast.error('Book not found')
        navigate('/', { replace: true })
        return
      }
      const prog = await getProgress(bookId)
      if (cancelled) return
      setBook(rec)
      setInitialLocator(prog?.locator ?? null)
      setLastBookId(bookId)
    })().catch((err) => {
      console.error(err)
      setLoadError(String(err))
    })
    return () => {
      cancelled = true
    }
  }, [bookId, navigate])

  const blob = book?.blob ?? null
  const { view, loading, error } = useFoliateView(
    containerRef,
    initialLocator === undefined ? null : blob,
    initialLocator,
  )

  const progress = useReadingProgress(view, bookId)
  const estimate = useReadingSpeed(view)
  const { settings, update } = useLayoutSettings(view)
  const tocItems = useToc(view)
  const voice = useVoiceNav(view, settings.voiceNavEnabled)

  // Per-book chapter resolver: given a DOM Range, returns which TOC item
  // (all depths — matches the picker) contains it. Used by useTTS to detect
  // chapter boundaries at block boundaries, independent of the paginator's
  // coarse page-level fraction.
  const resolveChapterRefImpl = useRef<(range: Range) => number | null>(() => null)
  useEffect(() => {
    if (!view) {
      resolveChapterRefImpl.current = () => null
      return
    }
    const sectionAnchorsCache = new Map<
      Document,
      Array<{ chapterIdx: number; anchor: Element }>
    >()
    const book = view.book
    // Derive the DOM anchor id we expect for a given TOC href.
    // MOBI: filepos:NNNNNNN → id=filepos{NNN}
    // EPUB: path#fragment → id={fragment}
    const getExpectedAnchorId = (href: string): string | null => {
      const mobiMatch = href.match(/^filepos:(.+)$/)
      if (mobiMatch) return `filepos${mobiMatch[1]}`
      const hashIdx = href.indexOf('#')
      if (hashIdx >= 0) return href.slice(hashIdx + 1)
      return null
    }

    // Duck-type element check — `instanceof Element` uses the current window's
    // constructor chain and returns false for nodes coming from an iframe's
    // document. nodeType===1 is ELEMENT_NODE universally.
    const isElement = (n: unknown): n is Element =>
      !!n && typeof n === 'object' && (n as Node).nodeType === 1

    const getSectionAnchors = (doc: Document) => {
      const cached = sectionAnchorsCache.get(doc)
      if (cached) return cached

      // Build an id → element map by walking elements directly. Bypasses the
      // browser's `getElementById` / `[id="…"]` lookup which silently fails on
      // foliate's MOBI-rendered doc (text/html contentType but not an
      // HTMLDocument instance, so id-attribute indexing doesn't work).
      const idMap = new Map<string, Element>()
      const allWithId = doc.querySelectorAll('[id]')
      for (const el of Array.from(allWithId)) {
        const id = el.getAttribute('id')
        if (id) idMap.set(id, el)
      }

      const out: Array<{ chapterIdx: number; anchor: Element }> = []
      if (book?.resolveHref) {
        for (let i = 0; i < tocItems.length; i++) {
          const resolved = book.resolveHref(tocItems[i].href)
          if (!resolved) continue
          // Try foliate's own anchor resolver first (works for most EPUBs).
          let node: unknown = null
          try {
            node = resolved.anchor(doc)
          } catch {
            // ignore
          }
          if (!isElement(node)) {
            // Fallback: look up via our pre-built id map.
            const id = getExpectedAnchorId(tocItems[i].href)
            if (id) {
              const found = idMap.get(id)
              if (found) node = found
            }
          }
          if (isElement(node)) out.push({ chapterIdx: i, anchor: node })
        }
        out.sort((a, b) => {
          const cmp = a.anchor.compareDocumentPosition(b.anchor)
          if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) return -1
          if (cmp & Node.DOCUMENT_POSITION_PRECEDING) return 1
          return 0
        })
      }
      sectionAnchorsCache.set(doc, out)
      return out
    }
    resolveChapterRefImpl.current = (range: Range) => {
      const doc = range.startContainer.ownerDocument
      if (!doc) return null
      const anchors = getSectionAnchors(doc)
      if (anchors.length === 0) return null
      let found = -1
      for (const { chapterIdx, anchor } of anchors) {
        const cmp = anchor.compareDocumentPosition(range.startContainer)
        const anchorBefore =
          cmp === 0 || !!(cmp & Node.DOCUMENT_POSITION_FOLLOWING) ||
          !!(cmp & Node.DOCUMENT_POSITION_CONTAINED_BY)
        if (anchorBefore) found = chapterIdx
        else break
      }
      return found >= 0 ? found : null
    }
  }, [view, tocItems])
  const resolveChapterForRange = useCallback(
    (range: Range) => resolveChapterRefImpl.current(range),
    [],
  )
  const tts = useTTS(view, {
    provider: settings.ttsProvider,
    voiceURI: settings.ttsVoiceURI,
    cloudVoice: settings.ttsCloudVoice,
    rate: settings.ttsRate,
    pitch: settings.ttsPitch,
    resolveChapterForRange,
  })

  useEffect(() => {
    if (error) {
      toast.error('Could not open this book (possibly DRM-protected or unsupported).')
    }
  }, [error])

  useEffect(() => {
    if (voice.status === 'denied') {
      toast.error('Microphone permission denied. Voice commands disabled.')
      update({ voiceNavEnabled: false })
    }
  }, [voice.status, update])

  // Forward relocate reason to the hook for user-nav cancel; chapter-end
  // detection is now done block-by-block inside useTTS via resolveChapterForRange.
  useEffect(() => {
    if (!view) return
    const onRelocate = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { reason?: string } | undefined
      tts.handleRelocate({ reason: detail?.reason, chapterKey: null })
    }
    view.addEventListener('relocate', onRelocate)
    return () => view.removeEventListener('relocate', onRelocate)
  }, [view, tts])

  // Delay the loading pill so quick (cached) fetches don't flash it.
  const [showLoadingPill, setShowLoadingPill] = useState(false)
  useEffect(() => {
    if (!tts.loading) {
      setShowLoadingPill(false)
      return
    }
    const t = window.setTimeout(() => setShowLoadingPill(true), 250)
    return () => window.clearTimeout(t)
  }, [tts.loading])

  // Surface audiobook errors (e.g. all retries exhausted on a paragraph).
  useEffect(() => {
    if (tts.status === 'error' && tts.errorMessage) {
      toast.error(tts.errorMessage)
    }
  }, [tts.status, tts.errorMessage])

  return (
    <div className="flex h-screen flex-col bg-background">
      <ReaderTopbar
        title={book?.title ?? 'Loading…'}
        percent={progress.percent}
        estimate={estimate}
        showEstimates={settings.showEstimates}
        voice={voice}
        voiceEnabled={settings.voiceNavEnabled}
        onToggleVoice={() => update({ voiceNavEnabled: !settings.voiceNavEnabled })}
        tts={tts}
        onToggleSleepMode={() =>
          tts.setSleepMode(tts.sleepMode === 'chapter-end' ? 'off' : 'chapter-end')
        }
        onOpenToc={() => setTocOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <main className="relative flex-1 overflow-hidden">
        <div ref={containerRef} className="h-full w-full" />
        {(loading || initialLocator === undefined) && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-sm text-muted-foreground">
            Opening book…
          </div>
        )}
        {(error || loadError) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <div className="text-sm text-destructive">
              Could not open this book. It may be DRM-protected or an unsupported variant.
            </div>
            <Button asChild variant="outline">
              <Link to="/">Back to library</Link>
            </Button>
          </div>
        )}
        <ReaderNav view={view} />
        {showLoadingPill && (
          <div
            role="status"
            aria-live="polite"
            className="pointer-events-none absolute bottom-6 left-1/2 z-40 -translate-x-1/2"
          >
            <div className="flex items-center gap-2 rounded-full border bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span>Waiting for next paragraph…</span>
            </div>
          </div>
        )}
      </main>

      <TocSheet
        open={tocOpen}
        onOpenChange={setTocOpen}
        items={tocItems}
        currentHref={progress.tocHref}
        onJump={(href) => view?.goTo(href)}
      />

      <SettingsSheet
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        settings={settings}
        onChange={update}
      />
    </div>
  )
}
