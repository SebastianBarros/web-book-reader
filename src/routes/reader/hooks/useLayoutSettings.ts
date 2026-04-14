import { useCallback, useEffect, useState } from 'react'
import type { View } from '@/vendor/foliate-js/view.js'
import { defaultSettings, loadSettings, saveSettings, type LayoutSettings } from '@/lib/db'
import { buildContentCSS } from '@/lib/book'

export function useLayoutSettings(view: View | null) {
  const [settings, setSettings] = useState<LayoutSettings>(defaultSettings)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    loadSettings()
      .then((s) => setSettings(s))
      .catch((err) => console.error('Failed to load settings', err))
      .finally(() => setHydrated(true))
  }, [])

  useEffect(() => {
    if (!view) return
    const css = buildContentCSS(settings)
    view.renderer?.setStyles?.(css)
  }, [view, settings])

  useEffect(() => {
    if (!view?.renderer) return
    view.renderer.setAttribute('flow', settings.flow)
  }, [view, settings.flow])

  useEffect(() => {
    if (!view?.renderer) return
    view.renderer.setAttribute('max-column-count', String(settings.maxColumns))
  }, [view, settings.maxColumns])

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'sepia')
    if (settings.theme !== 'light') root.classList.add(settings.theme)
    return () => {
      root.classList.remove('dark', 'sepia')
    }
  }, [settings.theme])

  const update = useCallback((patch: Partial<LayoutSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      saveSettings(next).catch((err) => console.error('Failed to save settings', err))
      return next
    })
  }, [])

  return { settings, update, hydrated }
}
