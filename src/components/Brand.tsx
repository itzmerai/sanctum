/**
 * The Sanctum mark: a keyhole set in a pointed arch (R2).
 *
 * The simplified member of the icon family. The full artwork -- the arch with
 * a vault door and the woven S, used for the installer and the site -- stops
 * being legible below about 48px, and this renders at 16px in the title bar.
 * So this carries the same silhouette with the interior dropped, which is how
 * icon families normally work rather than a compromise.
 *
 * Stroked rather than filled, and drawn in `currentColor`, so it takes the
 * accent it is placed on across all six accents and both themes.
 */
export function SanctumMark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="Sanctum"
      style={{ display: 'block' }}
    >
      <path
        d="M23 90 L23 47 Q26 20 50 8 Q74 20 77 47 L77 90"
        fill="none"
        stroke="currentColor"
        strokeWidth={11}
        strokeLinejoin="miter"
      />
      <circle cx="50" cy="50" r="8" fill="currentColor" />
      <path d="M46.5 57 L53.5 57 L56.5 75 L43.5 75 Z" fill="currentColor" />
    </svg>
  )
}

/** Logo plus wordmark, as it appears in the title bar and lock screen. */
export function Wordmark({ size = 18 }: { size?: number }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize: size * 0.78,
        letterSpacing: '0.01em',
      }}
    >
      <SanctumMark size={size} />
      Sanctum
    </span>
  )
}
