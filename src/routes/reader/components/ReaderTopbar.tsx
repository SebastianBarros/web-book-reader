import { Link } from 'react-router-dom'
import { ArrowLeft, ListOrdered, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDuration, type TimeEstimate } from '../hooks/useReadingSpeed'

interface ReaderTopbarProps {
  title: string
  percent: number
  estimate: TimeEstimate
  showEstimates: boolean
  onOpenToc: () => void
  onOpenSettings: () => void
}

export function ReaderTopbar({
  title,
  percent,
  estimate,
  showEstimates,
  onOpenToc,
  onOpenSettings,
}: ReaderTopbarProps) {
  const chapterLabel = estimate.ready ? formatDuration(estimate.chapterMsRemaining) : ''
  const bookLabel = estimate.ready ? formatDuration(estimate.bookMsRemaining) : ''

  const parts: string[] = []
  if (chapterLabel) parts.push(`${chapterLabel} in chapter`)
  if (bookLabel) parts.push(`${bookLabel} in book`)

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur">
      <Button asChild variant="ghost" size="icon" aria-label="Back to library">
        <Link to="/">
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="min-w-0 flex-1 truncate text-sm font-medium">{title}</div>
      {showEstimates && (
        <div className="hidden items-center gap-3 text-xs tabular-nums text-muted-foreground sm:flex">
          <span>{(percent * 100).toFixed(1)}%</span>
          {parts.length > 0 && (
            <TooltipProvider delayDuration={200}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="cursor-help border-l pl-3">
                    {parts.map((p, i) => (
                      <span key={p}>
                        {i > 0 && <span className="mx-1.5">·</span>}
                        {p}
                      </span>
                    ))}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  Estimated from your reading speed so far.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      )}
      <Button variant="ghost" size="icon" onClick={onOpenToc} aria-label="Table of contents">
        <ListOrdered className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onOpenSettings} aria-label="Settings">
        <Settings className="h-4 w-4" />
      </Button>
    </header>
  )
}
