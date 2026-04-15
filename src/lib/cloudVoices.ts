export interface FeaturedVoice {
  id: string
  label: string
  note: string
}

/**
 * Hand-picked voices that show up at the top of the picker.
 * These are verified to sound good for long-form audiobook reading in Spanish.
 */
export const FEATURED_VOICES: FeaturedVoice[] = [
  {
    id: 'es-US-Chirp-HD-F',
    label: 'es-US · Chirp HD · F (female)',
    note: 'Latin American Spanish — default',
  },
  {
    id: 'es-US-Chirp-HD-D',
    label: 'es-US · Chirp HD · D (male)',
    note: 'Latin American Spanish',
  },
  {
    id: 'es-ES-Chirp-HD-F',
    label: 'es-ES · Chirp HD · F (female)',
    note: 'Castilian Spanish',
  },
  {
    id: 'es-ES-Neural2-G',
    label: 'es-ES · Neural2 · G (male)',
    note: 'Castilian Spanish',
  },
]

export const DEFAULT_CLOUD_VOICE = 'es-US-Chirp-HD-F'
