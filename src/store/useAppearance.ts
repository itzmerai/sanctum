/**
 * Appearance state: theme, accent, font size, sidebar mode (U8, R14, R37).
 *
 * Persisted to `localStorage`, deliberately **not** to the vault. These are
 * non-secret preferences that must be readable while the vault is locked --
 * the lock screen has to know whether to render dark, and it has no key.
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type Theme = 'light' | 'dark'
export type Accent = 'sage' | 'clay' | 'slate' | 'moss' | 'stone' | 'dusk'
export type FontSize = 'small' | 'medium' | 'large'

/** The three sidebar states the reference cycles through (R14). */
export type SidebarMode = 'expanded' | 'rail' | 'hidden'

export const ACCENTS: { id: Accent; label: string }[] = [
  { id: 'sage', label: 'Sage' },
  { id: 'clay', label: 'Clay' },
  { id: 'slate', label: 'Slate' },
  { id: 'moss', label: 'Moss' },
  { id: 'stone', label: 'Stone' },
  { id: 'dusk', label: 'Dusk' },
]

interface AppearanceState {
  theme: Theme
  accent: Accent
  fontSize: FontSize
  sidebar: SidebarMode
  /** Device-only display name, shown in the sidebar and greeting (R36). */
  displayName: string
  /** Website icons default OFF (R24, AE12) -- the reference shows On. */
  websiteIcons: boolean

  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  setAccent: (accent: Accent) => void
  setFontSize: (size: FontSize) => void
  setSidebar: (mode: SidebarMode) => void
  cycleSidebar: () => void
  setDisplayName: (name: string) => void
  setWebsiteIcons: (on: boolean) => void
}

export const useAppearance = create<AppearanceState>()(
  persist(
    (set, get) => ({
      theme: 'light',
      accent: 'slate',
      fontSize: 'medium',
      sidebar: 'expanded',
      displayName: '',
      websiteIcons: false,

      setTheme: (theme) => set({ theme }),
      toggleTheme: () => set({ theme: get().theme === 'dark' ? 'light' : 'dark' }),
      setAccent: (accent) => set({ accent }),
      setFontSize: (fontSize) => set({ fontSize }),
      setSidebar: (sidebar) => set({ sidebar }),
      cycleSidebar: () =>
        set({
          sidebar:
            get().sidebar === 'expanded'
              ? 'rail'
              : get().sidebar === 'rail'
                ? 'hidden'
                : 'expanded',
        }),
      setDisplayName: (displayName) => set({ displayName }),
      setWebsiteIcons: (websiteIcons) => set({ websiteIcons }),
    }),
    { name: 'sanctum.appearance' },
  ),
)

/** Applies the current appearance to the document root. */
export function applyAppearance(state: {
  theme: Theme
  accent: Accent
  fontSize: FontSize
}): void {
  const root = document.documentElement
  root.dataset.theme = state.theme
  root.dataset.accent = state.accent
  root.dataset.size = state.fontSize
}
