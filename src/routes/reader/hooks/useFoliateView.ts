import { useEffect, useRef, useState } from 'react'
import '@/vendor/foliate-js/view.js'
import type { View } from '@/vendor/foliate-js/view.js'

export interface FoliateViewState {
  view: View | null
  loading: boolean
  error: Error | null
}

export function useFoliateView(
  containerRef: React.RefObject<HTMLElement | null>,
  blob: Blob | null,
  initialLocator: string | null | undefined,
) {
  const [state, setState] = useState<FoliateViewState>({
    view: null,
    loading: true,
    error: null,
  })
  const viewRef = useRef<View | null>(null)

  useEffect(() => {
    if (!blob || !containerRef.current) return
    let cancelled = false
    const container = containerRef.current

    setState({ view: null, loading: true, error: null })

    const view = document.createElement('foliate-view') as View
    view.style.display = 'block'
    view.style.width = '100%'
    view.style.height = '100%'
    container.append(view)
    viewRef.current = view

    ;(async () => {
      try {
        await view.open(blob as File)
        if (cancelled) return
        await view.init({ lastLocation: initialLocator ?? null, showTextStart: !initialLocator })
        if (cancelled) return
        setState({ view, loading: false, error: null })
      } catch (err) {
        if (cancelled) return
        console.error(err)
        setState({
          view: null,
          loading: false,
          error: err instanceof Error ? err : new Error(String(err)),
        })
      }
    })()

    return () => {
      cancelled = true
      try {
        view.close()
      } catch {
        // ignore
      }
      view.remove()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob])

  return state
}
