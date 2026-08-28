/**
 * Light/dark switch (U4).
 *
 * An icon button sitting in the header nav, the same way the app puts its
 * theme control in the sidebar rather than labelling it.
 *
 * The plan called for scoping the theme to the replica so a visitor could see
 * both without changing the page. The app's token file defines its palettes on
 * `:root[data-theme]`, so a replica-scoped switch would mean re-declaring
 * every colour in the site - the copy KTD3 exists to forbid, and the first
 * thing that would drift. So the toggle flips the document, and the whole site
 * renders in the product's design system.
 *
 * `Base.astro` applies the stored theme before first paint; this component
 * only handles changing it. This is the only JavaScript the site ships.
 */
import { useEffect, useState } from 'react'

import { Icon } from '@app/components/Icon'

type Theme = 'light' | 'dark'

const KEY = 'sanctum.site.theme'

export function ThemeToggle() {
  // Starts dark to match the statically rendered markup, then syncs to
  // whatever the pre-paint script already applied.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const applied = document.documentElement.dataset.theme
    if (applied === 'light' || applied === 'dark') setTheme(applied)
  }, [])

  function choose(next: Theme) {
    setTheme(next)
    document.documentElement.dataset.theme = next
    try {
      localStorage.setItem(KEY, next)
    } catch {
      // A remembered theme is a convenience, not a requirement.
    }
  }

  const next: Theme = theme === 'dark' ? 'light' : 'dark'

  return (
    <button
      type="button"
      className="themeToggle"
      onClick={() => choose(next)}
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
    </button>
  )
}
