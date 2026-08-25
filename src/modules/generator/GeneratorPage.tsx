/**
 * The password generator (U11: R25).
 *
 * Generation happens in Rust. The WebView asks for a password and receives
 * one; it never draws randomness itself, so there is a single CSPRNG to audit
 * (see `crypto/generator.rs` for the rejection sampling and class guarantees).
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { Icon } from '../../components/Icon'
import {
  CommandError,
  clipboard,
  generator,
  setup,
  type GeneratorOptions,
  type StrengthReport,
} from '../../lib/ipc'
import './generator.css'

const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent']

const TOGGLES: { key: keyof Omit<GeneratorOptions, 'length'>; label: string; hint: string }[] = [
  { key: 'uppercase', label: 'Uppercase', hint: 'A-Z' },
  { key: 'lowercase', label: 'Lowercase', hint: 'a-z' },
  { key: 'numbers', label: 'Numbers', hint: '0-9' },
  { key: 'symbols', label: 'Symbols', hint: '!@#' },
]

export function GeneratorPage() {
  const navigate = useNavigate()
  const [options, setOptions] = useState<GeneratorOptions>({
    length: 20,
    uppercase: true,
    lowercase: true,
    numbers: true,
    symbols: true,
  })
  const [password, setPassword] = useState('')
  const [strength, setStrength] = useState<StrengthReport | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const regenerate = useCallback(async (next: GeneratorOptions) => {
    try {
      setPassword(await generator.generate(next))
      setError(null)
    } catch (raw) {
      setError(raw instanceof CommandError ? raw.message : String(raw))
      setPassword('')
    }
  }, [])

  useEffect(() => {
    void regenerate(options)
  }, [options, regenerate])

  useEffect(() => {
    if (!password) {
      setStrength(null)
      return
    }
    let cancelled = false
    void setup
      .passwordStrength(password)
      .then((report) => {
        if (!cancelled) setStrength(report)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [password])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  /** Refuses to disable the last remaining character class. */
  function toggle(key: keyof Omit<GeneratorOptions, 'length'>) {
    const next = { ...options, [key]: !options[key] }
    const anyEnabled = TOGGLES.some((t) => next[t.key])
    if (!anyEnabled) return
    setOptions(next)
  }

  async function copy() {
    try {
      const receipt = await clipboard.copyText(password, true)
      setToast(
        receipt.exclusion === 'excluded'
          ? 'Copied. Clears in 30 seconds.'
          : 'Copied, but Windows may keep its own copy in clipboard history.',
      )
    } catch (raw) {
      setToast(raw instanceof CommandError ? raw.message : 'Could not copy.')
    }
  }

  const score = strength?.score ?? 0

  return (
    <div data-testid="route-generate">
      <header className="page__head">
        <h1 className="page__title">Generate Password</h1>
        <p className="page__sub">
          Create strong passwords and use them when saving a credential.
        </p>
      </header>

      <div className="card gen">
        <div className="gen__output">
          <output className="gen__value" aria-live="polite" aria-label="Generated password">
            {password || '—'}
          </output>
          <div className="gen__outputActions">
            <button
              className="iconbtn"
              onClick={() => void regenerate(options)}
              aria-label="Generate a new password"
            >
              <Icon name="history" />
            </button>
            <button
              className="iconbtn"
              onClick={copy}
              disabled={!password}
              aria-label="Copy password"
            >
              <Icon name="copy" />
            </button>
          </div>
        </div>

        {password && (
          <>
            <div className="meter" aria-hidden="true">
              <span style={{ width: `${((score + 1) / 5) * 100}%` }} />
            </div>
            <p className="meter__label">{SCORE_LABELS[score]}</p>
          </>
        )}

        {error && (
          <p className="form__hint" data-error="true" role="alert">
            {error}
          </p>
        )}

        <div className="gen__row">
          <label className="label" htmlFor="gen-length">
            Length
          </label>
          <span className="gen__length">{options.length}</span>
        </div>
        <input
          id="gen-length"
          className="gen__slider"
          type="range"
          min={8}
          max={64}
          value={options.length}
          onChange={(event) => setOptions({ ...options, length: Number(event.target.value) })}
          aria-label="Password length"
        />

        <div className="gen__toggles">
          {TOGGLES.map((item) => (
            <button
              key={item.key}
              type="button"
              className="gen__toggle"
              data-on={options[item.key]}
              onClick={() => toggle(item.key)}
              aria-pressed={options[item.key]}
            >
              <span className="gen__toggleLabel">{item.label}</span>
              <span className="gen__toggleHint">{item.hint}</span>
            </button>
          ))}
        </div>

        <button
          className="btn btn-primary gen__use"
          disabled={!password}
          onClick={() =>
            navigate('/vault', { state: { generatedPassword: password } })
          }
        >
          <Icon name="plus" /> Use in new credential
        </button>
      </div>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
