/** The Sanctum mark: a keyhole set in an arch (R2). */
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
        fill="currentColor"
        fillRule="evenodd"
        d="M20 85.5 L20 50.5 A30 30 0 0 1 80 50.5 L80 85.5 Z
           M50 32.7 A10.8 10.8 0 1 0 50 54.3 A10.8 10.8 0 1 0 50 32.7 Z
           M45.8 43.5 L54.2 43.5 L58.2 71.5 L41.8 71.5 Z"
      />
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
