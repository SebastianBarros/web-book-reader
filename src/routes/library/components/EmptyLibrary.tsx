import { BookPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface EmptyLibraryProps {
  onBrowse: () => void
}

export function EmptyLibrary({ onBrowse }: EmptyLibraryProps) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 rounded-xl border-2 border-dashed p-10 text-center">
      <BookPlus className="h-12 w-12 text-muted-foreground" />
      <div>
        <div className="text-lg font-semibold">Your library is empty</div>
        <div className="mt-1 text-sm text-muted-foreground">
          Drag and drop MOBI, EPUB, or AZW3 files anywhere on this page to add them.
        </div>
      </div>
      <Button onClick={onBrowse}>Browse files</Button>
    </div>
  )
}
