import { Link } from 'react-router-dom'
import { ArrowLeft, ListOrdered, Mic, MicOff, Settings } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatDuration, type TimeEstimate } from '../hooks/useReadingSpeed'
import type { VoiceNavState } from '../hooks/useVoiceNav'

interface ReaderTopbarProps {
  title: string
  percent: number
  estimate: TimeEstimate
  showEstimates: boolean
  voice: VoiceNavState
  voiceEnabled: boolean
  onToggleVoice: () => void
  onOpenToc: () => void
  onOpenSettings: () => void
}

export function ReaderTopbar({
  title,
  percent,
  estimate,
  showEstimates,
  voice,
  voiceEnabled,
  onToggleVoice,
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
      {voice.supported && (
        <TooltipProvider delayDuration={300}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={onToggleVoice}
                aria-label={voiceEnabled ? 'Disable voice commands' : 'Enable voice commands'}
                aria-pressed={voiceEnabled}
                className={cn(voice.status === 'listening' && 'text-red-500')}
              >
                {voiceEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">
              {voice.status === 'denied'
                ? 'Microphone permission denied'
                : voiceEnabled
                  ? 'Voice commands on: say "next" or "back"'
                  : 'Enable voice commands'}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
