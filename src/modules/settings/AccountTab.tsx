/**
 * Account settings (U21: R36).
 *
 * The display name and avatar are device-only preferences in localStorage,
 * not vault records: the greeting has to render before anything is unlocked.
 */
import { SanctumMark } from '../../components/Brand'
import { Icon } from '../../components/Icon'
import { useAppearance } from '../../store/useAppearance'

export function AccountTab() {
  const { displayName, setDisplayName } = useAppearance()

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Profile picture</h2>
          <p className="setrow__hint">Shown in the sidebar. Stored only on this device.</p>
        </div>
        <div className="setrow__control">
          <span className="account__avatar">
            <SanctumMark size={22} />
          </span>
        </div>
      </section>

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
        <span className="account__avatar account__avatar--small">
          <SanctumMark size={16} />
        </span>
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
