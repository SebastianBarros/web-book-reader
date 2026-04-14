import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import {
  deleteBook as dbDeleteBook,
  listBooks,
  putBook,
  type BookRecord,
} from '@/lib/db'
import { detectFormat, extractMetadata } from '@/lib/book'

function genId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `book_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
}

export function useBookList() {
  const [books, setBooks] = useState<BookRecord[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    const next = await listBooks()
    setBooks(next)
  }, [])

  useEffect(() => {
    refresh()
      .catch((err) => {
        console.error(err)
        toast.error('Failed to load library')
      })
      .finally(() => setLoading(false))
  }, [refresh])

  const addFiles = useCallback(
    async (files: File[]) => {
      let added = 0
      for (const file of files) {
        const format = detectFormat(file.name)
        if (!format) {
          toast.error(`${file.name}: unsupported file type`)
          continue
        }
        try {
          const meta = await extractMetadata(file)
          const record: BookRecord = {
            id: genId(),
            title: meta.title,
            author: meta.author,
            cover: meta.cover,
            format,
            addedAt: Date.now(),
            blob: file,
            filename: file.name,
          }
          await putBook(record)
          added += 1
        } catch (err) {
          console.error(err)
          toast.error(`${file.name}: could not open (possibly DRM-protected or unsupported)`)
        }
      }
      if (added) {
        toast.success(`Added ${added} book${added === 1 ? '' : 's'} to library`)
        await refresh()
      }
    },
    [refresh],
  )

  const removeBook = useCallback(
    async (id: string) => {
      await dbDeleteBook(id)
      await refresh()
    },
    [refresh],
  )

  return { books, loading, addFiles, removeBook, refresh }
}
