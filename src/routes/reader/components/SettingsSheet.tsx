import { Sun, Moon, Coffee } from 'lucide-react'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { LayoutSettings } from '@/lib/db'

interface SettingsSheetProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  settings: LayoutSettings
  onChange: (patch: Partial<LayoutSettings>) => void
}

export function SettingsSheet({ open, onOpenChange, settings, onChange }: SettingsSheetProps) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[90vw] sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Reading settings</SheetTitle>
        </SheetHeader>
        <div className="mt-6 flex flex-col gap-6">
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
        </div>
      </SheetContent>
    </Sheet>
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
