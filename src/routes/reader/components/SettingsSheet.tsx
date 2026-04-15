import { Sun, Moon, Coffee, BookOpen, BookCopy, ScrollText, Cloud, HardDrive } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { LayoutSettings, TTSProvider } from '@/lib/db'
import { FONT_OPTIONS, getFontOption } from '@/lib/fonts'
import { FEATURED_VOICES } from '@/lib/cloudVoices'
import { useSpeechVoices, type BrowserVoice } from '../hooks/useSpeechVoices'

type FlowMode = 'single' | 'spread' | 'scrolled'

function flowMode(s: LayoutSettings): FlowMode {
  if (s.flow === 'scrolled') return 'scrolled'
  return s.maxColumns === 1 ? 'single' : 'spread'
}

function flowModeToPatch(mode: FlowMode): Partial<LayoutSettings> {
  switch (mode) {
    case 'single':
      return { flow: 'paginated', maxColumns: 1 }
    case 'spread':
      return { flow: 'paginated', maxColumns: 2 }
    case 'scrolled':
      return { flow: 'scrolled' }
  }
}

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  settings: LayoutSettings
  onChange: (patch: Partial<LayoutSettings>) => void
}

export function SettingsSheet({ open, onOpenChange, settings, onChange }: SettingsSheetProps) {
  const voices = useSpeechVoices()
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90vw] sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Reading settings</SheetTitle>
        </SheetHeader>
        <div className="mt-6 flex flex-col gap-6">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-sm font-medium">Font</div>
              <div
                className="text-xs text-muted-foreground"
                style={{ fontFamily: getFontOption(settings.fontFamily).stack }}
              >
                Aa · The quick brown fox
              </div>
            </div>
            <select
              value={settings.fontFamily}
              onChange={(e) => onChange({ fontFamily: e.target.value })}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {FONT_OPTIONS.map((f) => (
                <option key={f.id} value={f.id} style={{ fontFamily: f.stack }}>
                  {f.label}
                  {f.description ? ` — ${f.description}` : ''}
                </option>
              ))}
            </select>
          </div>
          <SliderRow
            label="Font size"
            value={settings.fontSize}
            min={12}
            max={32}
            step={1}
            unit="px"
            onChange={(v) => onChange({ fontSize: v })}
          />
          <SliderRow
            label="Line height"
            value={settings.lineHeight}
            min={1.1}
            max={2.2}
            step={0.05}
            fmt={(v) => v.toFixed(2)}
            onChange={(v) => onChange({ lineHeight: v })}
          />
          <SliderRow
            label="Horizontal margin"
            value={settings.marginInline}
            min={0}
            max={120}
            step={4}
            unit="px"
            onChange={(v) => onChange({ marginInline: v })}
          />
          <SliderRow
            label="Column width"
            value={settings.columnWidth}
            min={400}
            max={1200}
            step={20}
            unit="px"
            onChange={(v) => onChange({ columnWidth: v })}
          />
          <div className="space-y-2">
            <div className="text-sm font-medium">Reading flow</div>
            <ToggleGroup
              type="single"
              value={flowMode(settings)}
              onValueChange={(value) => {
                if (!value) return
                onChange(flowModeToPatch(value as FlowMode))
              }}
              className="w-full"
            >
              <ToggleGroupItem value="single" className="flex-1 gap-2">
                <BookOpen className="h-4 w-4" />
                Single
              </ToggleGroupItem>
              <ToggleGroupItem value="spread" className="flex-1 gap-2">
                <BookCopy className="h-4 w-4" />
                Spread
              </ToggleGroupItem>
              <ToggleGroupItem value="scrolled" className="flex-1 gap-2">
                <ScrollText className="h-4 w-4" />
                Scroll
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-0.5">
              <div className="text-sm font-medium">Show progress estimates</div>
              <div className="text-xs text-muted-foreground">
                Hide pages and time remaining for a distraction-free read.
              </div>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={settings.showEstimates}
                onChange={(e) => onChange({ showEstimates: e.target.checked })}
              />
              <span className="h-6 w-11 rounded-full bg-input transition-colors peer-checked:bg-primary" />
              <span className="absolute left-1 top-1 h-4 w-4 rounded-full bg-background shadow transition-transform peer-checked:translate-x-5" />
            </label>
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Theme</div>
            <ToggleGroup
              type="single"
              value={settings.theme}
              onValueChange={(value) => {
                if (value) onChange({ theme: value as LayoutSettings['theme'] })
              }}
              className="w-full"
            >
              <ToggleGroupItem value="light" className="flex-1 gap-2">
                <Sun className="h-4 w-4" />
                Light
              </ToggleGroupItem>
              <ToggleGroupItem value="sepia" className="flex-1 gap-2">
                <Coffee className="h-4 w-4" />
                Sepia
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" className="flex-1 gap-2">
                <Moon className="h-4 w-4" />
                Dark
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
          {typeof window !== 'undefined' && 'speechSynthesis' in window && (
            <AudiobookRows voices={voices} settings={settings} onChange={onChange} />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

interface AudiobookRowsProps {
  voices: BrowserVoice[]
  settings: LayoutSettings
  onChange: (patch: Partial<LayoutSettings>) => void
}

function AudiobookRows({ voices, settings, onChange }: AudiobookRowsProps) {
  return (
    <>
      <div className="space-y-2 border-t pt-4">
        <div className="text-sm font-medium">Audiobook voice provider</div>
        <ToggleGroup
          type="single"
          value={settings.ttsProvider}
          onValueChange={(value) => {
            if (value) onChange({ ttsProvider: value as TTSProvider })
          }}
          className="w-full"
        >
          <ToggleGroupItem value="cloud" className="flex-1 gap-2">
            <Cloud className="h-4 w-4" />
            Cloud (Google)
          </ToggleGroupItem>
          <ToggleGroupItem value="browser" className="flex-1 gap-2">
            <HardDrive className="h-4 w-4" />
            Browser
          </ToggleGroupItem>
        </ToggleGroup>
        <div className="text-xs text-muted-foreground">
          {settings.ttsProvider === 'cloud'
            ? 'Google Cloud TTS via our worker. Great quality, needs internet.'
            : 'Your OS / browser voices. Offline, quality depends on the device.'}
        </div>
      </div>

      {settings.ttsProvider === 'cloud' ? (
        <CloudVoicePicker settings={settings} onChange={onChange} />
      ) : (
        <BrowserVoicePicker voices={voices} settings={settings} onChange={onChange} />
      )}

      <SliderRow
        label="Speech rate"
        value={settings.ttsRate}
        min={0.5}
        max={2.0}
        step={0.05}
        fmt={(v) => `${v.toFixed(2)}×`}
        onChange={(v) => onChange({ ttsRate: v })}
      />
      {settings.ttsProvider === 'browser' && (
        <SliderRow
          label="Speech pitch"
          value={settings.ttsPitch}
          min={0.5}
          max={2.0}
          step={0.05}
          fmt={(v) => v.toFixed(2)}
          onChange={(v) => onChange({ ttsPitch: v })}
        />
      )}
    </>
  )
}

interface CloudVoicePickerProps {
  settings: LayoutSettings
  onChange: (patch: Partial<LayoutSettings>) => void
}

function CloudVoicePicker({ settings, onChange }: CloudVoicePickerProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Cloud voice</div>
        <div className="text-xs text-muted-foreground">Spanish picks</div>
      </div>
      <select
        value={settings.ttsCloudVoice}
        onChange={(e) => onChange({ ttsCloudVoice: e.target.value })}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        {FEATURED_VOICES.map((v) => (
          <option key={v.id} value={v.id}>
            {v.label} — {v.note}
          </option>
        ))}
      </select>
    </div>
  )
}

interface BrowserVoicePickerProps {
  voices: BrowserVoice[]
  settings: LayoutSettings
  onChange: (patch: Partial<LayoutSettings>) => void
}

function BrowserVoicePicker({ voices, settings, onChange }: BrowserVoicePickerProps) {
  const pageLang = document.documentElement.lang || navigator.language || 'en'
  const pageLangPrefix = pageLang.slice(0, 2).toLowerCase()
  const sameLang = voices.filter((v) => v.lang.toLowerCase().startsWith(pageLangPrefix))
  const others = voices.filter((v) => !v.lang.toLowerCase().startsWith(pageLangPrefix))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">Browser voice</div>
        <div className="text-xs text-muted-foreground">
          {voices.length === 0 ? 'Loading…' : `${voices.length} available`}
        </div>
      </div>
      <select
        value={settings.ttsVoiceURI ?? ''}
        onChange={(e) => onChange({ ttsVoiceURI: e.target.value || null })}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      >
        <option value="">System default</option>
        {sameLang.length > 0 && (
          <optgroup label={`Your language (${pageLangPrefix})`}>
            {sameLang.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} — {v.lang}
                {v.localService ? '' : ' (cloud)'}
              </option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other languages">
            {others.map((v) => (
              <option key={v.voiceURI} value={v.voiceURI}>
                {v.name} — {v.lang}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  )
}

interface SliderRowProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit?: string
  fmt?: (v: number) => string
  onChange: (v: number) => void
}

function SliderRow({ label, value, min, max, step, unit, fmt, onChange }: SliderRowProps) {
  const display = fmt ? fmt(value) : `${value}${unit ?? ''}`
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs tabular-nums text-muted-foreground">{display}</div>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={step}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}
