import type { View } from '@/vendor/foliate-js/view.js'

/**
 * Compute chapter boundary fractions by resolving each provided href to its
 * DOM anchor inside the target section, then measuring the anchor's text
 * offset relative to the section's total text length. Multiple boundaries
 * inside a single spine section get distinct fractions, unlike foliate's
 * built-in `tocItem.href` tracking which can silently collapse for some
 * MOBIs whose filepos anchors don't round-trip through TOCProgress.
 *
 * Returned array is sorted ascending and always ends with `1.0`.
 */
export async function computeChapterBoundaries(
  view: View,
  hrefs: string[],
): Promise<number[]> {
  const book = view.book
  if (!book?.resolveHref) return []
  const sectionFractions = view.getSectionFractions?.() ?? []
  if (sectionFractions.length === 0) return []

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

/**
 * Given a sorted list of boundary fractions and the current reading fraction,
 * return the index of the chapter the fraction belongs to. Uses the largest
 * boundary that is `<= fraction`, so 0-indexed chapter numbers.
 *
 * Returns -1 when no boundaries are available yet.
 */
export function chapterIndexAtFraction(boundaries: number[], fraction: number): number {
  if (boundaries.length === 0) return -1
  let idx = -1
  for (let i = 0; i < boundaries.length; i++) {
    if (boundaries[i] <= fraction + 1e-9) idx = i
    else break
  }
  return idx
}
