/**
 * First-run setup (U4: R5, R44, R46, KTD21).
 *
 * Two steps, and the second one cannot be skipped. The recovery code is shown
 * exactly once and is unrecoverable afterwards, so R46 requires a *typed*
 * acknowledgment rather than a button someone can click past — the reference
 * design's plain "I saved it" is one reflexive click away from a permanently
 * unrecoverable vault.
 */
import { useEffect, useState } from 'react'

import { Wordmark } from '../../components/Brand'
import { CommandError, setup, type StrengthReport } from '../../lib/ipc'
import './lock.css'

/** What the user must type to confirm they wrote the code down (R46). */
const CONFIRM_PHRASE = 'I saved it'

const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent']

interface Props {
  onComplete: () => void
}

export function SetupScreen({ onComplete }: Props) {
  const [step, setStep] = useState<'password' | 'recovery'>('password')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [reveal, setReveal] = useState(false)
  const [strength, setStrength] = useState<StrengthReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recoveryCode, setRecoveryCode] = useState('')
  const [typed, setTyped] = useState('')

  // Score on every change. Cheap by design -- zxcvbn only, no KDF work.
  useEffect(() => {
    let cancelled = false
    if (password.length === 0) {
      setStrength(null)
      return
    }
    void setup
      .passwordStrength(password)
      .then((report) => {
        if (!cancelled) setStrength(report)
      })
      .catch(() => {
        /* Scoring is advisory; the authoritative check runs in create_vault. */
      })
    return () => {
      cancelled = true
    }
  }, [password])

  const mismatch = confirm.length > 0 && confirm !== password
  const canSubmit = Boolean(strength?.acceptable) && !mismatch && confirm.length > 0 && !busy

  async function createVault(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return

    setBusy(true)
    setError(null)
    try {
      const { recoveryCode: code } = await setup.createVault(password)
      setRecoveryCode(code)
      // Drop both copies of the master password from component state.
      setPassword('')
      setConfirm('')
      setStep('recovery')
    } catch (raw) {
      setError(
        raw instanceof CommandError ? raw.message : raw instanceof Error ? raw.message : String(raw),
      )
    } finally {
      setBusy(false)
    }
  }

  async function finish() {
    await setup.acknowledgeRecoveryCode()
    onComplete()
  }

  const score = strength?.score ?? 0

  return (
    <div className="lock" data-tauri-drag-region>
      <header className="lock__chrome" data-tauri-drag-region>
        <Wordmark size={18} />
      </header>

      <main className="lock__body">
        <div className="setup__steps" aria-hidden="true">
          <span className="setup__step" data-on="true" />
          <span className="setup__step" data-on={step === 'recovery'} />
        </div>

        {step === 'password' ? (
          <>
            <h1 className="lock__tagline">Set a master password</h1>
            <p className="lock__sub">
              This is the only thing standing between your vault file and anyone who
              copies it. There is no way to reset it without your recovery code.
            </p>

            <form className="lock__form" onSubmit={createVault}>
              <div className="lock__field">
                <input
                  className="input lock__input"
                  type={reveal ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Master password"
                  autoComplete="new-password"
                  spellCheck={false}
                  aria-label="Master password"
                  autoFocus
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

              <div className="setup__meter" aria-hidden="true">
                <span style={{ width: `${((score + (password ? 1 : 0)) / 5) * 100}%` }} />
              </div>
              <div className="setup__meterRow">
                <span>{password ? SCORE_LABELS[score] : 'Enter a password'}</span>
                <span>{strength ? `${strength.length} chars` : ''}</span>
              </div>

              <input
                className="input lock__input"
                type={reveal ? 'text' : 'password'}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                placeholder="Confirm password"
                autoComplete="new-password"
                spellCheck={false}
                aria-label="Confirm master password"
              />

              <p className="setup__hint">
                {mismatch
                  ? 'The two passwords do not match.'
                  : (strength?.reason ??
                    'Twelve characters or more. A few unrelated words beat a short complicated one.')}
              </p>

              <button type="submit" className="btn btn-primary lock__submit" disabled={!canSubmit}>
                {busy ? 'Creating your vault…' : 'Create vault'}
              </button>

              <p className="lock__error" role="alert">
                {error ?? ' '}
              </p>
            </form>
          </>
        ) : (
          <>
            <h1 className="lock__tagline">Your recovery code</h1>

            <div className="lock__form">
              <p className="recovery__code">{recoveryCode}</p>

              <p className="recovery__warning">
                Write this down and keep it somewhere safe — <strong>not in this vault</strong>.
                It will not be shown again. Anyone with this code and your vault file can
                reset your password. <strong>If you lose both your password and this code,
                your data cannot be recovered by anyone, including us.</strong>
              </p>

              <div className="recovery__confirm">
                <p className="setup__hint" style={{ minHeight: 'auto', marginBottom: 8 }}>
                  Type <strong style={{ color: 'var(--lock-text)' }}>{CONFIRM_PHRASE}</strong> to
                  confirm you have written it down.
                </p>
                <input
                  className="input lock__input"
                  style={{ textAlign: 'left' }}
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  placeholder={CONFIRM_PHRASE}
                  autoComplete="off"
                  spellCheck={false}
                  aria-label={`Type "${CONFIRM_PHRASE}" to confirm`}
                  autoFocus
                />
              </div>

              <button
                type="button"
                className="btn btn-primary lock__submit"
                disabled={typed.trim().toLowerCase() !== CONFIRM_PHRASE.toLowerCase()}
                onClick={finish}
              >
                Continue
              </button>
            </div>
          </>
        )}
      </main>

      <footer className="lock__footer">
        <span>[ SYSTEM_STATUS: {step === 'recovery' ? 'SETUP' : 'NEW VAULT'} ]</span>
        <span>root@sanctum:~/vault/ &mdash; NO CLOUD. NO BACKDOORS. NO COMPROMISE.</span>
      </footer>
    </div>
  )
}
