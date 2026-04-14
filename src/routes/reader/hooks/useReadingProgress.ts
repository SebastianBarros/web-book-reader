import { useEffect, useRef, useState } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'
import { saveProgress } from '@/lib/db'

export interface ReadingProgress {
  percent: number
  cfi: string | null
  tocHref: string | null
}

export function useReadingProgress(view: View | null, bookId: string | undefined) {
  const [progress, setProgress] = useState<ReadingProgress>({
    percent: 0,
    cfi: null,
    tocHref: null,
  })
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    if (!view || !bookId) return

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent).detail as {
        fraction?: number
        cfi?: string
        tocItem?: { href?: string } | null
      } | undefined
      if (!detail) return
      const percent = typeof detail.fraction === 'number' ? detail.fraction : 0
      const cfi = detail.cfi ?? null
      const tocHref = detail.tocItem?.href ?? null
      setProgress({ percent, cfi, tocHref })

      if (saveTimer.current) window.clearTimeout(saveTimer.current)
      if (cfi) {
        saveTimer.current = window.setTimeout(() => {
          saveProgress({ bookId, locator: cfi, percent, updatedAt: Date.now() }).catch((err) =>
            console.error('Failed to save progress', err),
          )
        }, 400)
      }
    }

    view.addEventListener('relocate', handler)
    return () => {
      view.removeEventListener('relocate', handler)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [view, bookId])

  return progress
}
