/**
 * Unlock with a recovery code (U4/U5: R12, AE11).
 *
 * The code is accepted however it was typed — the Rust normaliser handles
 * case, spacing, hyphens, and Crockford's confusable letters. Someone reading
 * it off a piece of paper under stress should not be defeated by handwriting.
 */
import { useState } from 'react'

import { Wordmark } from '../../components/Brand'
import { WindowControls } from '../../components/WindowControls'
import { CommandError, session } from '../../lib/ipc'
import './lock.css'

interface Props {
  onUnlocked: () => void
  onCancel: () => void
}

export function RecoveryScreen({ onUnlocked, onCancel }: Props) {
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (busy || code.trim().length === 0) return

    setBusy(true)
    setError(null)
    try {
      await session.unlockWithRecovery(code)
      setCode('')
      onUnlocked()
    } catch (raw) {
      setError(
        raw instanceof CommandError && raw.kind === 'wrongSecret'
          ? 'That recovery code does not open this vault.'
          : raw instanceof Error
            ? raw.message
            : String(raw),
      )
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
        <h1 className="lock__tagline">Use your recovery code</h1>
        <p className="lock__sub">
          The code you wrote down when you created this vault. Capitals, spaces and
          dashes do not matter.
        </p>

        <form className="lock__form" onSubmit={submit}>
          <input
            className="input lock__input"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="SANCTUM-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX-XXXXX"
            autoComplete="off"
            spellCheck={false}
            aria-label="Recovery code"
            style={{ fontSize: '0.75rem' }}
            autoFocus
          />

          <button
            type="submit"
            className="btn btn-primary lock__submit"
            disabled={busy || code.trim().length === 0}
          >
            {busy ? 'Checking…' : 'Unlock with code'}
          </button>

          <p className="lock__error" role="alert">
            {error ?? ' '}
          </p>

          <button type="button" className="lock__link" onClick={onCancel}>
            Back to password
          </button>
        </form>
      </main>

      <footer className="lock__footer">
        <span>[ SYSTEM_STATUS: RECOVERY ]</span>
        <span>root@sanctum:~/vault/ &mdash; NO CLOUD. NO BACKDOORS. NO COMPROMISE.</span>
      </footer>
    </div>
  )
}
