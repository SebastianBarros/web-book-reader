import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BookOpen, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { BookRecord } from '@/lib/db'

interface BookCardProps {
  book: BookRecord
  onDelete: (id: string) => void
}

export function BookCard({ book, onDelete }: BookCardProps) {
  const [coverUrl, setCoverUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!book.cover) return
    const url = URL.createObjectURL(book.cover)
    setCoverUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [book.cover])

  return (
    <Card className="group relative flex flex-col overflow-hidden transition-shadow hover:shadow-md">
      <Link to={`/read/${book.id}`} className="flex flex-col">
        <div className="aspect-[2/3] w-full overflow-hidden bg-muted">
          {coverUrl ? (
            <img
              src={coverUrl}
              alt={book.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <BookOpen className="h-10 w-10 text-muted-foreground/60" />
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1 p-3">
          <div className="line-clamp-2 text-sm font-semibold">{book.title}</div>
          <div className="line-clamp-1 text-xs text-muted-foreground">{book.author}</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground/70">
            {book.format}
          </div>
        </div>
      </Link>
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-2 top-2 h-8 w-8 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={(e) => {
          e.preventDefault()
          if (confirm(`Remove "${book.title}" from library?`)) onDelete(book.id)
        }}
        aria-label="Remove book"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </Card>
  )
}
