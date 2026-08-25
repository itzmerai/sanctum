/**
 * Security settings (U21: R38).
 *
 * Where U5's rotation gets its controls. Two things are deliberate here:
 *
 * **The master-password help text does not say "re-encrypts every entry."**
 * The reference says that; it is false for this design. KTD9 re-wraps the data
 * key, so records are untouched — which is exactly why a change is instant and
 * crash-safe. Saying otherwise would misdescribe the guarantee.
 *
 * **A new recovery code is shown once and must be acknowledged** (R46), the
 * same as at setup, because rotating invalidates the old one immediately.
 */
import { useEffect, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { CommandError, session, setup, type StrengthReport } from '../../lib/ipc'

const CONFIRM_PHRASE = 'I saved it'
const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent']

export function SecurityTab() {
  const [minutes, setMinutes] = useState(5)
  const [rotatePassword, setRotatePassword] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [strength, setStrength] = useState<StrengthReport | null>(null)
  const [issued, setIssued] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)

  useEffect(() => {
    void session
      .status()
      .then((status) => setMinutes(status.autoLockMinutes || 5))
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!next) {
      setStrength(null)
      return
    }
    let cancelled = false
    void setup
      .passwordStrength(next)
      .then((report) => {
        if (!cancelled) setStrength(report)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [next])

  async function saveAutoLock(value: number) {
    setMinutes(value)
    try {
      await session.setAutoLockMinutes(value)
    } catch {
      setMessage({ kind: 'error', text: 'Could not save the auto-lock setting.' })
    }
  }

  async function regenerate() {
    setBusy(true)
    setMessage(null)
    try {
      const code = await session.rotateRecoveryCode(rotatePassword)
      setRotatePassword('')
      setIssued(code)
    } catch (raw) {
      setMessage({
        kind: 'error',
        text:
          raw instanceof CommandError && raw.kind === 'wrongSecret'
            ? 'That master password is not correct.'
            : raw instanceof Error
              ? raw.message
              : String(raw),
      })
    } finally {
      setBusy(false)
    }
  }

  async function changePassword(event: React.FormEvent) {
    event.preventDefault()
    if (next !== confirm || !strength?.acceptable || busy) return

    setBusy(true)
    setMessage(null)
    try {
      const code = await session.changeMasterPassword(current, next)
      setCurrent('')
      setNext('')
      setConfirm('')
      setIssued(code)
    } catch (raw) {
      setMessage({
        kind: 'error',
        text:
          raw instanceof CommandError && raw.kind === 'wrongSecret'
            ? 'That current password is not correct.'
            : raw instanceof Error
              ? raw.message
              : String(raw),
      })
    } finally {
      setBusy(false)
    }
  }

  const score = strength?.score ?? 0
  const mismatch = confirm.length > 0 && confirm !== next

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <label className="setrow__title" htmlFor="sec-autolock">
            Auto-lock
          </label>
          <p className="setrow__hint">
            Lock Sanctum after this many minutes without activity. Locking drops the key from
            memory — unlocking derives it again.
          </p>
        </div>
        <div className="setrow__control setrow__group">
          <input
            id="sec-autolock"
            className="input sec__minutes"
            type="number"
            min={1}
            max={1440}
            value={minutes}
            onChange={(event) => void saveAutoLock(Number(event.target.value))}
          />
          <span className="setrow__hint">min</span>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Clipboard clearing</h2>
          <p className="setrow__hint">
            Copied passwords clear after 30 seconds, and Sanctum asks Windows to keep them out
            of clipboard history and cloud sync. Other applications that watch the clipboard can
            still keep their own copies outside Sanctum.
          </p>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <h2 className="setrow__title">Recovery code</h2>
          <p className="setrow__hint">
            Recovery is enabled. Generating a new code replaces the current one immediately.
          </p>
        </div>
        <div className="setrow__control setrow__group">
          <input
            className="input"
            type="password"
            value={rotatePassword}
            onChange={(event) => setRotatePassword(event.target.value)}
            placeholder="Master password"
            autoComplete="current-password"
            aria-label="Master password to regenerate the recovery code"
          />
          <button
            className="btn"
            onClick={regenerate}
            disabled={rotatePassword.length === 0 || busy}
          >
            Regenerate
          </button>
        </div>
      </section>

      <form className="setrow" onSubmit={changePassword}>
        <div className="setrow__text">
          <h2 className="setrow__title">Master password</h2>
          <p className="setrow__hint">
            Changing it re-wraps the key that protects your entries. Your records are not
            rewritten, so the change is instant and cannot be interrupted halfway. Your recovery
            code is replaced at the same time.
          </p>
        </div>
        <div className="setrow__control sec__password">
          <input
            className="input"
            type="password"
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            placeholder="Current password"
            autoComplete="current-password"
            aria-label="Current password"
          />
          <input
            className="input"
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            placeholder="New password"
            autoComplete="new-password"
            aria-label="New password"
          />
          {next && (
            <>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${((score + 1) / 5) * 100}%` }} />
              </div>
              <p className="meter__label">
                {SCORE_LABELS[score]}
                {strength?.reason ? ` — ${strength.reason}` : ''}
              </p>
            </>
          )}
          <input
            className="input"
            type="password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            placeholder="Confirm new password"
            autoComplete="new-password"
            aria-label="Confirm new password"
            aria-invalid={mismatch}
          />
          {mismatch && (
            <p className="form__hint" data-error="true">
              The two passwords do not match.
            </p>
          )}
          <button
            type="submit"
            className="btn"
            disabled={!strength?.acceptable || mismatch || current.length === 0 || busy}
          >
            <Icon name="key" /> Change master password
          </button>
        </div>
      </form>

      {message && (
        <p className="form__hint" data-error={message.kind === 'error'} role="alert">
          {message.text}
        </p>
      )}

      {issued !== null && (
        <Modal
          title="Your new recovery code"
          onClose={() => {
            /* Deliberately not dismissable: the code cannot be shown again. */
          }}
          width={410}
          footer={
            <button
              className="btn btn-primary"
              disabled={typed.trim().toLowerCase() !== CONFIRM_PHRASE.toLowerCase()}
              onClick={() => {
                setIssued(null)
                setTyped('')
                setMessage({ kind: 'ok', text: 'Your recovery code was replaced.' })
              }}
            >
              Done
            </button>
          }
        >
          <p className="recovery__code sec__code">{issued}</p>
          <p className="setrow__hint">
            Write this down and keep it somewhere safe — not in this vault. It will not be shown
            again, and your previous code no longer works.
          </p>
          <label className="label field__label" htmlFor="sec-ack">
            Type &ldquo;{CONFIRM_PHRASE}&rdquo; to confirm
          </label>
          <input
            id="sec-ack"
            className="input"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            placeholder={CONFIRM_PHRASE}
            autoFocus
          />
        </Modal>
      )}
    </>
  )
}
