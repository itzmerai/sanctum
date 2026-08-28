/**
 * Light/dark switch (U4).
 *
 * The plan called for scoping the theme to the replica so a visitor could see
 * both without changing the page. The app's token file defines its palettes on
 * `:root[data-theme]`, so a replica-scoped switch would mean re-declaring
 * every colour in the site - the copy KTD3 exists to forbid, and the first
 * thing that would drift.
 *
 * So the toggle flips the document instead, and the whole site follows the
 * app's theming. That is the honest resolution and arguably the better demo:
 * the page a visitor is reading *is* rendered in the product's design system.
 *
 * This is the only component on the site that ships JavaScript.
 */
import { useEffect, useState } from 'react'

type Theme = 'light' | 'dark'

const KEY = 'sanctum.site.theme'

function preferred(): Theme {
  if (typeof window === 'undefined') return 'dark'
  try {
    const stored = localStorage.getItem(KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private browsing and blocked storage both land here; the media query
    // below is a perfectly good answer.
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark')

  // Read the preference after mount. Doing it during render would mismatch
  // the statically generated HTML, which is always emitted dark.
  useEffect(() => {
    setTheme(preferred())
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem(KEY, theme)
    } catch {
      // A remembered theme is a convenience, not a requirement.
    }
  }, [theme])

  const next = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className="themeToggle"
      onClick={() => setTheme(next)}
      aria-label={`Switch to ${next} theme`}
    >
      {theme === 'dark' ? 'Light' : 'Dark'}
    </button>
  )
}
