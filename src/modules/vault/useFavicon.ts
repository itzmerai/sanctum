/**
 * Website icon lookup (U12: R24, AE4, AE12).
 *
 * Two gates, deliberately. This hook returns early when the setting is off, and
 * `fetch_favicon` in Rust checks its own flag before opening a socket. Either
 * alone would be enough for the happy path; both together mean a UI bug cannot
 * cause a request the user did not ask for.
 *
 * Results are memoised per domain for the session so a list of forty rows
 * makes at most one request per distinct site.
 */
import { useEffect, useState } from 'react'

import { favicon } from '../../lib/ipc'
import { useAppearance } from '../../store/useAppearance'

/** Session cache. `null` means "asked, and there is no icon". */
const cache = new Map<string, string | null>()

export function useFavicon(website: string): string | null {
  const websiteIcons = useAppearance((state) => state.websiteIcons)
  const [icon, setIcon] = useState<string | null>(() => cache.get(website) ?? null)

  useEffect(() => {
    if (!websiteIcons || !website) {
      setIcon(null)
      return
    }

    const cached = cache.get(website)
    if (cached !== undefined) {
      setIcon(cached)
      return
    }

    let cancelled = false
    void favicon
      .fetch(website)
      .then((result) => {
        cache.set(website, result)
        if (!cancelled) setIcon(result)
      })
      .catch(() => {
        // A failed lookup is not worth surfacing; the generic tile is fine.
        cache.set(website, null)
      })

    return () => {
      cancelled = true
    }
  }, [website, websiteIcons])

  return icon
}
