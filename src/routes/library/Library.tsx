import { useRef } from 'react'
import { BookPlus } from 'lucide-react'
import { DropZone, type DropZoneHandle } from '@/components/DropZone'
import { Button } from '@/components/ui/button'
import { useBookList } from './hooks/useBookList'
import { BookCard } from './components/BookCard'
import { EmptyLibrary } from './components/EmptyLibrary'

const ACCEPTED = ['.mobi', '.epub', '.azw3', '.azw', '.fb2', '.fbz', '.cbz']

export default function Library() {
  const { books, loading, addFiles, removeBook } = useBookList()
  const dropRef = useRef<DropZoneHandle>(null)

  return (
    <DropZone
      ref={dropRef}
      onFiles={addFiles}
      accept={ACCEPTED}
      className="min-h-screen"
    >
      <div className="mx-auto max-w-6xl px-6 py-8">
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Library</h1>
            <p className="text-sm text-muted-foreground">
              Drag and drop books anywhere on this page.
            </p>
          </div>
          <Button onClick={() => dropRef.current?.openFileDialog()}>
            <BookPlus className="h-4 w-4" />
            Add books
          </Button>
        </header>

        {loading ? (
          <div className="py-20 text-center text-sm text-muted-foreground">Loading…</div>
        ) : books.length === 0 ? (
          <EmptyLibrary onBrowse={() => dropRef.current?.openFileDialog()} />
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6">
            {books.map((book) => (
              <BookCard key={book.id} book={book} onDelete={removeBook} />
            ))}
          </div>
        )}
      </div>
    </DropZone>
  )
}
