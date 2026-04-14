export interface FontOption {
  id: string
  label: string
  description?: string
  stack: string
  googleFontsName?: string
}

export const FONT_OPTIONS: FontOption[] = [
  {
    id: 'Literata',
    label: 'Literata',
    description: 'Bookerly-alike (default)',
    stack: '"Literata", Georgia, "Times New Roman", serif',
    googleFontsName: 'Literata:opsz,wght@7..72,400;7..72,700;7..72,400i;7..72,700i',
  },
  {
    id: 'Merriweather',
    label: 'Merriweather',
    stack: '"Merriweather", Georgia, "Times New Roman", serif',
    googleFontsName: 'Merriweather:wght@400;700&display=swap',
  },
  {
    id: 'Lora',
    label: 'Lora',
    stack: '"Lora", Georgia, "Times New Roman", serif',
    googleFontsName: 'Lora:wght@400;700&display=swap',
  },
  {
    id: 'Source Serif 4',
    label: 'Source Serif',
    stack: '"Source Serif 4", Georgia, "Times New Roman", serif',
    googleFontsName: 'Source+Serif+4:wght@400;700&display=swap',
  },
  {
    id: 'Inter',
    label: 'Inter (sans)',
    stack: '"Inter", system-ui, -apple-system, sans-serif',
    googleFontsName: 'Inter:wght@400;700&display=swap',
  },
  {
    id: 'Georgia',
    label: 'Georgia (system)',
    stack: 'Georgia, "Times New Roman", serif',
  },
  {
    id: 'System sans',
    label: 'System sans',
    stack: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  },
]

export function getFontOption(id: string): FontOption {
  return FONT_OPTIONS.find((f) => f.id === id) ?? FONT_OPTIONS[0]
}

export function googleFontsImportUrl(): string {
  const families = FONT_OPTIONS.filter((f) => f.googleFontsName)
    .map((f) => `family=${f.googleFontsName}`)
    .join('&')
  return `https://fonts.googleapis.com/css2?${families}&display=swap`
}
