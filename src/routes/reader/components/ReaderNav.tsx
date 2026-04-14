import { useEffect } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'

interface ReaderNavProps {
  view: View | null
}

export function ReaderNav({ view }: ReaderNavProps) {
  useEffect(() => {
    if (!view) return
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        void view.goLeft()
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault()
        void view.goRight()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [view])

  return (
    <>
      <button
        type="button"
        aria-label="Previous page"
        className="absolute inset-y-0 left-0 w-[15%] cursor-w-resize bg-transparent focus:outline-none"
        onClick={() => view?.goLeft()}
      />
      <button
        type="button"
        aria-label="Next page"
        className="absolute inset-y-0 right-0 w-[15%] cursor-e-resize bg-transparent focus:outline-none"
        onClick={() => view?.goRight()}
      />
    </>
  )
}
