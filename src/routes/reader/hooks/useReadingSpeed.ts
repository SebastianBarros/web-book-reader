import { useEffect, useRef, useState } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'
import {
  emptyReadingStats,
  loadReadingStats,
  saveReadingStats,
  type ReadingStats,
} from '@/lib/db'

const IDLE_GAP_MS = 5 * 60 * 1000
const MIN_SAMPLE_MS = 750
const EMA_ALPHA = 0.2
const MIN_ACTIVE_MS_TO_ESTIMATE = 60 * 1000

export interface TimeEstimate {
  ready: boolean
  bookMsRemaining: number | null
  chapterMsRemaining: number | null
}

interface RelocateDetail {
  fraction?: number
}

function collectTocHrefs(items: unknown, out: string[]): void {
  if (!Array.isArray(items)) return
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { href?: string; subitems?: unknown }
    if (item.href) out.push(item.href)
    if (item.subitems) collectTocHrefs(item.subitems, out)
  }
}

// Compute chapter boundary fractions by resolving each TOC href to its DOM
// anchor inside the target section, then measuring the anchor's text offset
// relative to the section's total text length. This gives intra-section
// precision for books where multiple chapters share one spine section.
async function computeChapterBoundariesAsync(view: View): Promise<number[]> {
  const book = view.book
  if (!book?.toc || !book.resolveHref) return []
  const sectionFractions = view.getSectionFractions?.() ?? []
  if (sectionFractions.length === 0) return []

  const hrefs: string[] = []
  collectTocHrefs(book.toc, hrefs)

  // Group by target section so each section's DOM is parsed at most once.
  const bySection = new Map<number, Array<(doc: Document) => unknown>>()
  for (const href of hrefs) {
    const resolved = book.resolveHref(href)
    if (!resolved || typeof resolved.index !== 'number') continue
    const list = bySection.get(resolved.index) ?? []
    list.push(resolved.anchor as (doc: Document) => unknown)
    bySection.set(resolved.index, list)
  }

  const set = new Set<number>()
  for (const [index, anchors] of bySection) {
    const section = book.sections[index]
    const sectionStart = sectionFractions[index] ?? 0
    const sectionEnd = sectionFractions[index + 1] ?? sectionStart
    const sectionRange = sectionEnd - sectionStart
    if (sectionRange <= 0 || !section?.createDocument) {
      set.add(sectionStart)
      continue
    }
    try {
      const doc = await section.createDocument()
      const body = doc.body
      const totalLen = body?.textContent?.length ?? 0
      for (const anchor of anchors) {
        const within = totalLen > 0 ? measureWithinSection(doc, anchor, totalLen) : 0
        set.add(sectionStart + within * sectionRange)
      }
    } catch (err) {
      console.debug('boundary: section load failed', index, err)
      set.add(sectionStart)
    }
  }
  set.add(1)
  return [...set].sort((a, b) => a - b)
}

function measureWithinSection(
  doc: Document,
  anchor: (doc: Document) => unknown,
  totalLen: number,
): number {
  try {
    const result = anchor(doc)
    if (!result || !doc.body) return 0
    const range = doc.createRange()
    range.setStart(doc.body, 0)
    if (result instanceof Range) {
      range.setEnd(result.startContainer, result.startOffset)
    } else if (result instanceof Node) {
      range.setEndBefore(result)
    } else {
      return 0
    }
    const before = range.toString().length
    return Math.max(0, Math.min(1, before / totalLen))
  } catch {
    return 0
  }
}

export function useReadingSpeed(view: View | null): TimeEstimate {
  const [estimate, setEstimate] = useState<TimeEstimate>({
    ready: false,
    bookMsRemaining: null,
    chapterMsRemaining: null,
  })
  const statsRef = useRef<ReadingStats>(emptyReadingStats)
  const lastSampleRef = useRef<{ fraction: number; t: number } | null>(null)
  const boundariesRef = useRef<number[]>([])
  const saveTimer = useRef<number | null>(null)

  useEffect(() => {
    loadReadingStats()
      .then((s) => {
        statsRef.current = s
      })
      .catch((err) => console.error('Failed to load reading stats', err))
  }, [])

  useEffect(() => {
    if (!view) {
      boundariesRef.current = []
      return
    }
    let cancelled = false
    boundariesRef.current = []
    computeChapterBoundariesAsync(view)
      .then((bs) => {
        if (!cancelled) boundariesRef.current = bs
      })
      .catch((err) => console.error('Failed to compute chapter boundaries', err))
    return () => {
      cancelled = true
    }
  }, [view])

  useEffect(() => {
    if (!view) return

    const handler = (ev: Event) => {
      const detail = (ev as CustomEvent<RelocateDetail>).detail
      if (!detail || typeof detail.fraction !== 'number') return
      const now = performance.now()
      const fraction = detail.fraction
      const prev = lastSampleRef.current

      if (prev) {
        const dt = now - prev.t
        const df = fraction - prev.fraction
        const validSample = dt >= MIN_SAMPLE_MS && dt <= IDLE_GAP_MS && df > 0
        if (validSample) {
          const instant = df / dt
          const cur = statsRef.current
          const emaRate =
            cur.sampleCount === 0 ? instant : EMA_ALPHA * instant + (1 - EMA_ALPHA) * cur.emaRate
          const next: ReadingStats = {
            emaRate,
            sampleCount: cur.sampleCount + 1,
            totalActiveMs: cur.totalActiveMs + dt,
            updatedAt: Date.now(),
          }
          statsRef.current = next
          if (saveTimer.current) window.clearTimeout(saveTimer.current)
          saveTimer.current = window.setTimeout(() => {
            saveReadingStats(next).catch((err) =>
              console.error('Failed to save reading stats', err),
            )
          }, 1500)
        }
      }

      lastSampleRef.current = { fraction, t: now }

      const rate = statsRef.current.emaRate
      const active = statsRef.current.totalActiveMs
      const ready = rate > 0 && active >= MIN_ACTIVE_MS_TO_ESTIMATE
      if (!ready) {
        setEstimate({
          ready: false,
          bookMsRemaining: null,
          chapterMsRemaining: null,
        })
        return
      }
      const bookMs = Math.max(0, (1 - fraction) / rate)
      let chapterMs: number | null = null
      const boundaries = boundariesRef.current
      if (boundaries.length > 0) {
        const next = boundaries.find((b) => b > fraction + 1e-9)
        if (typeof next === 'number') chapterMs = Math.max(0, (next - fraction) / rate)
      }
      setEstimate({
        ready: true,
        bookMsRemaining: bookMs,
        chapterMsRemaining: chapterMs,
      })
    }

    view.addEventListener('relocate', handler)
    return () => {
      view.removeEventListener('relocate', handler)
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [view])

  return estimate
}

export function formatDuration(ms: number | null): string {
  if (ms == null || !isFinite(ms) || ms < 0) return ''
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 1) return '< 1 min'
  if (totalMinutes < 60) return `${totalMinutes} min`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`
}
