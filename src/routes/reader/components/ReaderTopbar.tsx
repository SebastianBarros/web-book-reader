import { Link } from 'react-router-dom'
import { ArrowLeft, ListOrdered, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ReaderTopbarProps {
  title: string
  percent: number
  onOpenToc: () => void
  onOpenSettings: () => void
}

export function ReaderTopbar({ title, percent, onOpenToc, onOpenSettings }: ReaderTopbarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <Button asChild variant="ghost" size="icon" aria-label="Back to library">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      <div className="hidden text-xs tabular-nums text-muted-foreground sm:block">
        {(percent * 100).toFixed(1)}%
      </div>
      <Button variant="ghost" size="icon" onClick={onOpenToc} aria-label="Table of contents">
        <ListOrdered className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  )
}
