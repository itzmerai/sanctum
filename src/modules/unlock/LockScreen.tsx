/**
 * The lock screen (U4: R3, R6, AE1).
 *
 * Layout and copy follow reference screenshot 1. The footer strings are R3
 * brand text, rebranded per docs/reference/visual-grounding.md.
 *
 * One deliberate behaviour: a wrong password produces a single, unhelpful
 * message. It does not say whether the vault exists, how many attempts remain,
 * or how close the guess was -- none of which the user needs and all of which
 * an attacker would.
 */
import { useEffect, useRef, useState } from 'react'

import { Wordmark } from '../../components/Brand'
import { WindowControls } from '../../components/WindowControls'
import { CommandError, session } from '../../lib/ipc'
import './lock.css'

interface Props {
  onUnlocked: () => void
  onForgotPassword: () => void
}

export function LockScreen({ onUnlocked, onForgotPassword }: Props) {
  const [password, setPassword] = useState('')
  const [reveal, setReveal] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.focus()
  }, [])

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || password.length === 0) return

    setBusy(true)
    setError(null)
    try {
      await session.unlock(password)
      // Clear the field before navigating away: React keeps the value alive in
      // state otherwise, and it is the master password.
      setPassword('')
      onUnlocked()
    } catch (raw) {
      const message =
        raw instanceof CommandError && raw.kind === 'wrongSecret'
          ? 'That password does not open this vault.'
          : raw instanceof Error
            ? raw.message
            : String(raw)
      setError(message)
      setPassword('')
      field.current?.focus()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock" data-tauri-drag-region>
      <header className="lock__chrome" data-tauri-drag-region>
        <Wordmark size={18} />
        <WindowControls maximizable={false} />
      </header>

      <main className="lock__body">
        <div className="lock__mark">
          <Wordmark size={44} />
        </div>

        <h1 className="lock__tagline">Coded for privacy.</h1>
        <p className="lock__sub">
          Your vault stays encrypted and private.
          <br />
          Everything stays local to your device.
        </p>

        <form className="lock__form" onSubmit={submit}>
          <div className="lock__field">
            <input
              ref={field}
              className="input lock__input"
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Master password"
              autoComplete="off"
              spellCheck={false}
              aria-label="Master password"
              aria-invalid={error !== null}
              disabled={busy}
            />
            <button
              type="button"
              className="lock__reveal"
              onClick={() => setReveal((on) => !on)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {reveal ? '●' : '○'}
            </button>
          </div>

          <button
            type="submit"
            className="btn btn-primary lock__submit"
            disabled={busy || password.length === 0}
          >
            {busy ? 'Working…' : 'Unlock'}
          </button>

          {/* Reserved height, so an error does not shift the form. */}
          <p className="lock__error" role="alert">
            {error ?? ' '}
          </p>

          <button type="button" className="lock__link" onClick={onForgotPassword}>
            Forgot password? Use recovery code
          </button>
        </form>

        <p className="lock__badge">AES-256 &middot; Argon2id &middot; Local-first &middot; v0.1.0</p>
      </main>

      <footer className="lock__footer">
        <span>[ SYSTEM_STATUS: LOCKED ]</span>
        <span>root@sanctum:~/vault/ &mdash; NO CLOUD. NO BACKDOORS. NO COMPROMISE.</span>
        <span>HAND-CODED FOR PRIVACY. ALL RIGHTS RESERVED.</span>
      </footer>
    </div>
  )
}
