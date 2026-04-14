import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface DropZoneHandle {
  openFileDialog: () => void
}

interface DropZoneProps {
  onFiles: (files: File[]) => void
  accept?: string[]
  className?: string
  children?: React.ReactNode
}

export const DropZone = forwardRef<DropZoneHandle, DropZoneProps>(function DropZone(
  { onFiles, accept, className, children },
  ref,
) {
  const [isDragging, setIsDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useImperativeHandle(ref, () => ({
    openFileDialog: () => inputRef.current?.click(),
  }))

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (e.currentTarget === e.target) setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      const filtered = accept
        ? files.filter((f) => accept.some((ext) => f.name.toLowerCase().endsWith(ext)))
        : files
      if (filtered.length) onFiles(filtered)
    },
    [accept, onFiles],
  )

  const handleInputChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files?.length) onFiles(Array.from(e.target.files))
      e.target.value = ''
    },
    [onFiles],
  )

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn('relative', className)}
    >
      {children}
      <input
        ref={inputRef}
        type="file"
        className="hidden"
        multiple
        accept={accept?.join(',')}
        onChange={handleInputChange}
      />
      {isDragging && (
        <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-primary/10 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-primary bg-background/90 px-10 py-8 shadow-lg">
            <Upload className="h-10 w-10 text-primary" />
            <div className="text-lg font-medium">Drop to add to library</div>
            <div className="text-sm text-muted-foreground">
              {accept?.join(', ') ?? 'any file'}
            </div>
          </div>
        </div>
      )}
    </div>
  )
})
