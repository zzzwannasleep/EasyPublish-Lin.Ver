export type ThemePaletteId =
  | 'apricot-mist'
  | 'water-lilies'
  | 'giverny-garden'
  | 'haystack-dawn'

export interface ThemePaletteDefinition {
  value: ThemePaletteId
  labelKey: string
  swatches: readonly [string, string, string]
}

const STORAGE_KEY = 'nexus-publish-theme-palette'
const DEFAULT_THEME_PALETTE: ThemePaletteId = 'apricot-mist'

export const THEME_PALETTE_DEFINITIONS: readonly ThemePaletteDefinition[] = [
  {
    value: 'apricot-mist',
    labelKey: 'common.theme.palette.apricotMist',
    swatches: ['#c16037', '#1f6f78', '#ad7a14'],
  },
  {
    value: 'water-lilies',
    labelKey: 'common.theme.palette.waterLilies',
    swatches: ['#4f84a7', '#5f8c56', '#b85f6b'],
  },
  {
    value: 'giverny-garden',
    labelKey: 'common.theme.palette.givernyGarden',
    swatches: ['#5e8452', '#b65d76', '#8b6fbe'],
  },
  {
    value: 'haystack-dawn',
    labelKey: 'common.theme.palette.haystackDawn',
    swatches: ['#b77a2f', '#587295', '#5d8a5c'],
  },
] as const

export function isThemePaletteId(value: string | null | undefined): value is ThemePaletteId {
  return THEME_PALETTE_DEFINITIONS.some(option => option.value === value)
}

export function readStoredThemePalette(): ThemePaletteId {
  if (typeof window === 'undefined') {
    return DEFAULT_THEME_PALETTE
  }

  const stored = window.localStorage.getItem(STORAGE_KEY)
  return isThemePaletteId(stored) ? stored : DEFAULT_THEME_PALETTE
}

export function persistThemePalette(value: ThemePaletteId) {
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(STORAGE_KEY, value)
  }
}

export function applyThemePalette(value: ThemePaletteId) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.palette = value
  }
}
