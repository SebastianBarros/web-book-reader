import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

export interface BookRecord {
  id: string
  title: string
  author: string
  cover?: Blob
  format: string
  addedAt: number
  blob: Blob
  filename: string
}

export interface ProgressRecord {
  bookId: string
  locator: string
  percent: number
  updatedAt: number
}

export interface LayoutSettings {
  fontSize: number
  lineHeight: number
  marginInline: number
  columnWidth: number
  theme: 'light' | 'dark' | 'sepia'
  flow: 'paginated' | 'scrolled'
  maxColumns: 1 | 2
  fontFamily: string
  showEstimates: boolean
}

export const defaultSettings: LayoutSettings = {
  fontSize: 18,
  lineHeight: 1.5,
  marginInline: 24,
  columnWidth: 720,
  theme: 'light',
  flow: 'paginated',
  maxColumns: 1,
  fontFamily: 'Literata',
  showEstimates: true,
}

export interface ReadingStats {
  emaRate: number // fractions of book per millisecond
  sampleCount: number
  totalActiveMs: number
  updatedAt: number
}

export const emptyReadingStats: ReadingStats = {
  emaRate: 0,
  sampleCount: 0,
  totalActiveMs: 0,
  updatedAt: 0,
}

interface ReaderDB extends DBSchema {
  books: {
    key: string
    value: BookRecord
    indexes: { 'by-addedAt': number }
  }
  progress: {
    key: string
    value: ProgressRecord
  }
  settings: {
    key: string
    value: LayoutSettings
  }
  stats: {
    key: string
    value: ReadingStats
  }
}

let dbPromise: Promise<IDBPDatabase<ReaderDB>> | null = null

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<ReaderDB>('online-mobi-reader', 2, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          const books = db.createObjectStore('books', { keyPath: 'id' })
          books.createIndex('by-addedAt', 'addedAt')
          db.createObjectStore('progress', { keyPath: 'bookId' })
          db.createObjectStore('settings')
        }
        if (oldVersion < 2) {
          db.createObjectStore('stats')
        }
      },
    })
  }
  return dbPromise
}

export async function listBooks(): Promise<BookRecord[]> {
  const db = await getDB()
  const all = await db.getAllFromIndex('books', 'by-addedAt')
  return all.reverse()
}

export async function getBook(id: string): Promise<BookRecord | undefined> {
  const db = await getDB()
  return db.get('books', id)
}

export async function putBook(book: BookRecord): Promise<void> {
  const db = await getDB()
  await db.put('books', book)
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB()
  const tx = db.transaction(['books', 'progress'], 'readwrite')
  await Promise.all([tx.objectStore('books').delete(id), tx.objectStore('progress').delete(id)])
  await tx.done
}

export async function getProgress(bookId: string): Promise<ProgressRecord | undefined> {
  const db = await getDB()
  return db.get('progress', bookId)
}

export async function saveProgress(record: ProgressRecord): Promise<void> {
  const db = await getDB()
  await db.put('progress', record)
}

export async function loadSettings(): Promise<LayoutSettings> {
  const db = await getDB()
  const stored = await db.get('settings', 'layout')
  return { ...defaultSettings, ...(stored ?? {}) }
}

export async function saveSettings(settings: LayoutSettings): Promise<void> {
  const db = await getDB()
  await db.put('settings', settings, 'layout')
}

export async function loadReadingStats(): Promise<ReadingStats> {
  const db = await getDB()
  const stored = await db.get('stats', 'global')
  return stored ?? emptyReadingStats
}

export async function saveReadingStats(stats: ReadingStats): Promise<void> {
  const db = await getDB()
  await db.put('stats', stats, 'global')
}
