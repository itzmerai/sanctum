/**
 * The user's avatar (U21: R36).
 *
 * Falls back to the Sanctum mark when no picture has been chosen, so every
 * place that shows an avatar has something to show.
 *
 * The image is a data URI held in `localStorage`, not in the vault: the
 * sidebar renders it before anything is unlocked, and a picture of the user is
 * not a secret. It is downscaled on the way in — see `readImageAsAvatar`.
 */
import { SanctumMark } from './Brand'
import { useAppearance } from '../store/useAppearance'

/** Longest edge of a stored avatar, in pixels. */
export const AVATAR_SIZE = 160

/** Refuse anything that could not plausibly be an image. */
const MAX_SOURCE_BYTES = 12 * 1024 * 1024

export interface AvatarError {
  message: string
}

/**
 * Reads a picked file into a square, downscaled data URI.
 *
 * Downscaling is not cosmetic. `localStorage` holds a few megabytes total, and
 * a modern phone photo is larger than that on its own — storing one raw would
 * throw a quota error and lose the *other* preferences with it.
 */
export async function readImageAsAvatar(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw { message: 'That file is not an image.' } satisfies AvatarError
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw { message: 'That image is very large. Try one under 12 MB.' } satisfies AvatarError
  }

  const bitmap = await createImageBitmap(file).catch(() => {
    throw { message: 'That image could not be read.' } satisfies AvatarError
  })

  // Centre-crop to a square, then scale. Cropping before scaling keeps the
  // subject centred instead of squashing a landscape photo into a circle.
  const edge = Math.min(bitmap.width, bitmap.height)
  const sx = (bitmap.width - edge) / 2
  const sy = (bitmap.height - edge) / 2

  const canvas = document.createElement('canvas')
  canvas.width = AVATAR_SIZE
  canvas.height = AVATAR_SIZE
  const context = canvas.getContext('2d')
  if (!context) {
    throw { message: 'This device could not process the image.' } satisfies AvatarError
  }

  context.drawImage(bitmap, sx, sy, edge, edge, 0, 0, AVATAR_SIZE, AVATAR_SIZE)
  bitmap.close()

  // JPEG at 0.85 keeps a 160px avatar comfortably under 20 kB. PNG would be
  // several times larger for a photograph and no better to look at.
  return canvas.toDataURL('image/jpeg', 0.85)
}

interface Props {
  size?: number
  className?: string
}

export function Avatar({ size = 28, className }: Props) {
  const avatar = useAppearance((state) => state.avatar)

  if (avatar) {
    return (
      <img
        className={className ? `avatar ${className}` : 'avatar'}
        src={avatar}
        alt=""
        width={size}
        height={size}
        style={{ width: size, height: size }}
      />
    )
  }

  return (
    <span
      className={className ? `avatar avatar--mark ${className}` : 'avatar avatar--mark'}
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <SanctumMark size={Math.round(size * 0.58)} />
    </span>
  )
}
