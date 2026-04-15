import { useEffect, useRef, useState } from 'react'
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
  const tts = useTTS(view, {
    provider: settings.ttsProvider,
    voiceURI: settings.ttsVoiceURI,
    cloudVoice: settings.ttsCloudVoice,
    rate: settings.ttsRate,
    pitch: settings.ttsPitch,
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

  useEffect(() => {
    if (!view) return
    const onRelocate = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as { reason?: string } | undefined
      tts.handleRelocate(detail?.reason)
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
