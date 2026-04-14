import { useMemo } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'

export interface FlatTocItem {
  label: string
  href: string
  depth: number
}

function collect(items: unknown, depth: number, out: FlatTocItem[]) {
  if (!Array.isArray(items)) return
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue
    const item = raw as { label?: string; href?: string; subitems?: unknown }
    if (item.href && item.label) {
      out.push({ label: item.label, href: item.href, depth })
    }
    if (item.subitems) collect(item.subitems, depth + 1, out)
  }
}

export function useToc(view: View | null): FlatTocItem[] {
  return useMemo(() => {
    if (!view?.book) return []
    const out: FlatTocItem[] = []
    collect(view.book.toc, 0, out)
    return out
  }, [view])
}
