/**
 * The square tile beside a credential (U9).
 *
 * Renders the first letter of the name over a colour derived from the name
 * itself, so the same entry always looks the same without storing anything.
 * Real favicons are U12 and are off by default (R24) -- until then this is
 * the icon, not a placeholder for one.
 */
import { useFavicon } from './useFavicon'

const TINTS = ['#e8734a', '#4a7fc1', '#4aa86a', '#8b6ec9', '#e0a63c', '#d64550', '#4a9c9c']

function tintFor(seed: string): string {
  // Sum of code points, not a hash: this only needs to be stable and spread
  // out, and a cryptographic hash here would be noise.
  let total = 0
  for (let i = 0; i < seed.length; i++) total += seed.charCodeAt(i)
  return TINTS[total % TINTS.length]!
}

interface Props {
  name: string
  website?: string
  size?: number
}

export function EntityIcon({ name, website = '', size = 36 }: Props) {
  const icon = useFavicon(website)
  const letter = name.trim().charAt(0).toUpperCase() || '?'

  if (icon) {
    return (
      <img
        className="entityicon"
        src={icon}
        alt=""
        width={size}
        height={size}
        style={{ objectFit: 'contain', background: 'var(--bg-surface)' }}
      />
    )
  }

  return (
    <span
      className="entityicon"
      style={{
        width: size,
        height: size,
        background: tintFor(name),
        fontSize: size * 0.42,
      }}
      aria-hidden="true"
    >
      {letter}
    </span>
  )
}
