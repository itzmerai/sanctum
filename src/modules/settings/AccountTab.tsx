/**
 * Account settings (U21: R36).
 *
 * The display name and picture are device-only preferences in localStorage,
 * not vault records: the sidebar renders both before anything is unlocked, and
 * neither is a secret.
 */
import { useRef, useState } from 'react'

import { Avatar, readImageAsAvatar } from '../../components/Avatar'
import { Icon } from '../../components/Icon'
import { useAppearance } from '../../store/useAppearance'

export function AccountTab() {
  const { displayName, setDisplayName, avatar, setAvatar } = useAppearance()
  const picker = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)

  async function choose(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Reset immediately so picking the same file twice still fires a change.
    event.target.value = ''
    if (!file) return

    setError(null)
    try {
      setAvatar(await readImageAsAvatar(file))
    } catch (raw) {
      const message =
        typeof raw === 'object' && raw !== null && 'message' in raw
          ? String((raw as { message: unknown }).message)
          : 'That image could not be used.'
      setError(message)
    }
  }

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Profile picture</h2>
          <p className="setrow__hint">
            Shown in the sidebar. Stored only on this device, never in your vault and never
            sent anywhere.
          </p>
        </div>
        <div className="setrow__control account__picture">
          <button
            type="button"
            className="account__pick"
            onClick={() => picker.current?.click()}
            aria-label={avatar ? 'Change profile picture' : 'Choose a profile picture'}
          >
            <Avatar size={56} />
            <span className="account__pickOverlay">
              <Icon name="edit" size={14} />
            </span>
          </button>

          <div className="account__pictureActions">
            <button className="btn" onClick={() => picker.current?.click()}>
              {avatar ? 'Change' : 'Choose picture'}
            </button>
            {avatar && (
              <button className="btn" onClick={() => setAvatar(null)}>
                Remove
              </button>
            )}
          </div>

          <input
            ref={picker}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={choose}
            hidden
            aria-hidden="true"
            tabIndex={-1}
          />
        </div>
      </section>

      {error && (
        <p className="form__hint" data-error="true" role="alert">
          {error}
        </p>
      )}

      <section className="setrow">
        <div className="setrow__text">
          <label className="setrow__title" htmlFor="account-name">
            Display name
          </label>
          <p className="setrow__hint">Used in the sidebar and dashboard greeting.</p>
        </div>
        <div className="setrow__control">
          <input
            id="account-name"
            className="input"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Your name"
            maxLength={40}
          />
        </div>
      </section>

      <div className="card account__preview">
        <Avatar size={32} />
        <span className="account__previewText">
          <span className="label">Profile preview</span>
          <span className="account__previewName">{displayName || 'Your name'}</span>
          <span className="setrow__hint">Shown in the sidebar and dashboard.</span>
        </span>
        <span className="chip account__local">
          <Icon name="shield" size={12} /> Account preferences stay on this device.
        </span>
      </div>
    </>
  )
}
