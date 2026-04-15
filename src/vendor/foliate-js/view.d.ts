export class View extends HTMLElement {
  book: FoliateBook
  renderer: FoliateRenderer
  lastLocation: FoliateLocation | null
  tts?: FoliateTTS
  open(file: Blob | File | string): Promise<void>
  close(): void
  init(opts: { lastLocation?: string | null; showTextStart?: boolean }): Promise<void>
  goTo(target: string | number): Promise<void>
  goToFraction(frac: number): Promise<void>
  goLeft(): Promise<void>
  goRight(): Promise<void>
  next(): Promise<void>
  prev(): Promise<void>
  getSectionFractions(): number[]
  initTTS(
    granularity?: 'word' | 'sentence' | 'grapheme',
    highlight?: (range: Range) => void,
  ): Promise<void>
}

export interface FoliateTTS {
  doc: Document
  start(): string | undefined
  resume(): string | undefined
  next(paused?: boolean): string | undefined
  prev(paused?: boolean): string | undefined
  from(range: Range): string | undefined
  setMark(mark: string): void
}

export function makeBook(file: Blob | File | string): Promise<FoliateBook>

export interface FoliateRenderer extends HTMLElement {
  setStyles?: (css: string) => void
  next(): Promise<void>
  prev(): Promise<void>
  getContents?: () => Array<{ doc: Document; index: number }>
  scrollToAnchor?: (anchor: Range | Element | number, smooth?: boolean) => void
}

export interface FoliateTocItem {
  label: string
  href?: string
  subitems?: FoliateTocItem[] | null
}

export interface FoliateLanguageMap {
  [lang: string]: string
}

export interface FoliateContributor {
  name?: string | FoliateLanguageMap
  [key: string]: unknown
}

export interface FoliateMetadata {
  title?: string | FoliateLanguageMap
  author?: string | FoliateContributor | (string | FoliateContributor)[]
  language?: string | string[]
  [key: string]: unknown
}

export interface FoliateSection {
  id?: string | number
  linear?: string
  size?: number
  createDocument?: () => Promise<Document> | Document
}

export interface FoliateResolvedHref {
  index: number
  anchor: (doc: Document) => Element | Range | number | null | undefined
}

export interface FoliateBook {
  metadata?: FoliateMetadata
  toc?: FoliateTocItem[] | null
  getCover?: () => Promise<Blob | null> | Blob | null
  sections: FoliateSection[]
  dir?: string
  splitTOCHref?: (href: string) => [string | number, string?] | null | undefined
  resolveHref?: (href: string) => FoliateResolvedHref | null | undefined
}

export interface FoliateLocation {
  fraction: number
  location?: { current: number; total: number }
  tocItem?: { label?: string; href?: string } | null
  pageItem?: { label?: string } | null
  cfi?: string
  range?: Range
}

declare global {
  interface HTMLElementTagNameMap {
    'foliate-view': View
  }
}
