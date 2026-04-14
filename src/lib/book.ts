import { makeBook } from '@/vendor/foliate-js/view.js'
import type { LayoutSettings } from './db'

type UnknownRecord = Record<string, unknown>

function formatLanguageMap(x: unknown): string {
  if (!x) return ''
  if (typeof x === 'string') return x
  if (typeof x === 'object') {
    const obj = x as UnknownRecord
    const values = Object.values(obj)
    const first = values[0]
    return typeof first === 'string' ? first : ''
  }
  return ''
}

function formatAuthor(author: unknown): string {
  if (!author) return ''
  if (Array.isArray(author)) return author.map(formatAuthor).filter(Boolean).join(', ')
  if (typeof author === 'string') return author
  if (typeof author === 'object') {
    const obj = author as UnknownRecord
    if (typeof obj.name === 'string') return obj.name
    if (obj.name && typeof obj.name === 'object') return formatLanguageMap(obj.name)
  }
  return ''
}

export interface ExtractedBookMetadata {
  title: string
  author: string
  cover?: Blob
}

export async function extractMetadata(file: Blob): Promise<ExtractedBookMetadata> {
  const book = await makeBook(file as File)
  const title = formatLanguageMap(book.metadata?.title) || 'Untitled Book'
  const author = formatAuthor(book.metadata?.author) || 'Unknown Author'
  let cover: Blob | undefined
  try {
    const maybeBlob = await book.getCover?.()
    if (maybeBlob instanceof Blob) cover = maybeBlob
  } catch {
    // cover is optional
  }
  return { title, author, cover }
}

export function detectFormat(filename: string): string | null {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.epub')) return 'epub'
  if (lower.endsWith('.mobi')) return 'mobi'
  if (lower.endsWith('.azw3')) return 'azw3'
  if (lower.endsWith('.azw')) return 'azw'
  if (lower.endsWith('.fb2')) return 'fb2'
  if (lower.endsWith('.fbz') || lower.endsWith('.fb2.zip')) return 'fb2'
  if (lower.endsWith('.cbz')) return 'cbz'
  return null
}

export function buildContentCSS(settings: LayoutSettings): string {
  const themeColors = themeVars(settings.theme)
  return `
    @namespace epub "http://www.idpf.org/2007/ops";
    html {
      color-scheme: ${settings.theme === 'dark' ? 'dark' : 'light'};
      color: ${themeColors.fg};
      background: ${themeColors.bg};
    }
    body {
      font-size: ${settings.fontSize}px !important;
      line-height: ${settings.lineHeight} !important;
      max-inline-size: ${settings.columnWidth}px;
      padding-inline: ${settings.marginInline}px !important;
      color: ${themeColors.fg};
      background: ${themeColors.bg};
    }
    p, li, blockquote, div {
      line-height: ${settings.lineHeight} !important;
    }
    a, a:visited {
      color: ${themeColors.link};
    }
  `
}

function themeVars(theme: LayoutSettings['theme']) {
  switch (theme) {
    case 'dark':
      return { bg: '#111827', fg: '#e5e7eb', link: '#93c5fd' }
    case 'sepia':
      return { bg: '#f5ecd7', fg: '#3a2e1f', link: '#7c5e2a' }
    default:
      return { bg: '#ffffff', fg: '#111827', link: '#1d4ed8' }
  }
}
