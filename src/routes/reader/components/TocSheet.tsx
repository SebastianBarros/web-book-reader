import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { FlatTocItem } from '../hooks/useToc'

interface TocSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  items: FlatTocItem[]
  currentHref: string | null
  onJump: (href: string) => void
}

export function TocSheet({ open, onOpenChange, items, currentHref, onJump }: TocSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="left" className="w-[90vw] sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Contents</SheetTitle>
        </SheetHeader>
        <div className="mt-4 flex-1 overflow-y-auto pr-2">
          {items.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              This book has no table of contents.
            </div>
          ) : (
            <ul className="space-y-0.5">
              {items.map((item, i) => {
                const active = currentHref === item.href
                return (
                  <li key={`${item.href}-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        onJump(item.href)
                        onOpenChange(false)
                      }}
                      className={cn(
                        'w-full rounded px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent hover:text-accent-foreground',
                        active && 'bg-accent font-semibold text-accent-foreground',
                      )}
                      style={{ paddingLeft: `${item.depth * 14 + 8}px` }}
                    >
                      {item.label}
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
