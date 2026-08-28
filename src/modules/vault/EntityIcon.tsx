/**
 * The square tile beside a credential (U9).
 *
 * Renders the first letter of the name over a colour derived from the name
 * itself, so the same entry always looks the same without storing anything.
 * Real favicons are U12 and are off by default (R24) -- until then this is
 * the icon, not a placeholder for one.
 */
import { tintFor } from '../../lib/tints'
import { useFavicon } from './useFavicon'

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
