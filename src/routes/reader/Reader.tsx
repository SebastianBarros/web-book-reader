import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { getBook, getProgress, type BookRecord } from '@/lib/db'
import { setLastBookId } from '@/lib/storage'
import { useFoliateView } from './hooks/useFoliateView'
import { useReadingProgress } from './hooks/useReadingProgress'
import { useLayoutSettings } from './hooks/useLayoutSettings'
import { useReadingSpeed } from './hooks/useReadingSpeed'
import { useToc } from './hooks/useToc'
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

  useEffect(() => {
    if (error) {
      toast.error('Could not open this book (possibly DRM-protected or unsupported).')
    }
  }, [error])

  return (
    <div className="flex h-screen flex-col bg-background">
      <ReaderTopbar
        title={book?.title ?? 'Loading…'}
        percent={progress.percent}
        estimate={estimate}
        showEstimates={settings.showEstimates}
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
