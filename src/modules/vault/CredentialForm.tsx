/**
 * Create / edit a credential (U10: R22, R23, AE6).
 *
 * Editing does **not** prefill the password field with the stored value. It is
 * fetched only if the user chooses to reveal or replace it, so opening an
 * entry to fix a typo in its name never puts the password into a DOM node.
 * An untouched password field on save means "keep what is stored".
 */
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import {
  CommandError,
  type Credential,
  type StrengthReport,
  credentials,
  folders,
  generator,
  setup,
} from '../../lib/ipc'

/** R22 / AE6: a credential carries at most five tags. */
const MAX_TAGS = 5

const SCORE_LABELS = ['Very weak', 'Weak', 'Fair', 'Strong', 'Excellent']

interface Props {
  existing: Credential | null
  /** A password handed over by the generator (R25). */
  seedPassword?: string | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

interface FolderOption {
  id: number
  name: string
}

export function CredentialForm({ existing, seedPassword, onClose, onSaved }: Props) {
  const [name, setName] = useState(existing?.name ?? '')
  const [username, setUsername] = useState(existing?.username ?? '')
  const [password, setPassword] = useState(seedPassword ?? '')
  const [passwordTouched, setPasswordTouched] = useState(existing === null)
  const [website, setWebsite] = useState(existing?.website ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [tagText, setTagText] = useState(existing?.tags.join(', ') ?? '')
  const [folderId, setFolderId] = useState<number | null>(existing?.folderId ?? null)
  const [favorite, setFavorite] = useState(existing?.favorite ?? false)

  // A generated password arrives visible: the user just chose it on screen,
  // and masking it here would only invite a needless reveal click.
  const [reveal, setReveal] = useState(Boolean(seedPassword))
  const [strength, setStrength] = useState<StrengthReport | null>(null)
  const [options, setOptions] = useState<FolderOption[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void folders
      .list('passwords')
      .then((list) => setOptions(list.map((f) => ({ id: f.id, name: f.name }))))
      .catch(() => setOptions([]))
  }, [])

  useEffect(() => {
    if (!password) {
      setStrength(null)
      return
    }
    let cancelled = false
    void setup
      .passwordStrength(password, [name, username].filter(Boolean))
      .then((report) => {
        if (!cancelled) setStrength(report)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [password, name, username])

  const tags = useMemo(
    () =>
      tagText
        .split(',')
        .map((tag) => tag.trim().replace(/^#/, ''))
        .filter(Boolean),
    [tagText],
  )

  const tooManyTags = tags.length > MAX_TAGS
  const canSave = name.trim().length > 0 && !tooManyTags && !busy

  async function generatePassword() {
    const value = await generator.generate({
      length: 20,
      uppercase: true,
      lowercase: true,
      numbers: true,
      symbols: true,
    })
    setPassword(value)
    setPasswordTouched(true)
    setReveal(true)
  }

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    try {
      // An untouched field on edit means "keep the stored password", which
      // requires fetching it so the record can be written back whole.
      const finalPassword =
        passwordTouched || existing === null
          ? password
          : await credentials.revealPassword(existing.id)

      const input = {
        name: name.trim(),
        username: username.trim(),
        password: finalPassword,
        website: website.trim(),
        notes,
        tags,
        folderId,
      }

      const id = existing
        ? (await credentials.update(existing.id, input), existing.id)
        : await credentials.create(input)

      if (favorite !== (existing?.favorite ?? false)) {
        await credentials.setFavorite('credential', id, favorite)
      }

      await onSaved()
    } catch (raw) {
      setError(raw instanceof CommandError ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  const score = strength?.score ?? 0

  return (
    <Modal
      title={existing ? 'Edit credential' : 'New credential'}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="credential-form"
            className="btn btn-primary"
            disabled={!canSave}
          >
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="credential-form" onSubmit={save}>
        <div className="field">
          <label className="label field__label" htmlFor="cf-name">
            Name
          </label>
          <input
            id="cf-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. GitHub"
            autoComplete="off"
            required
          />
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="cf-username">
            Username / Email
          </label>
          <input
            id="cf-username"
            className="input"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="you@example.com"
            autoComplete="off"
          />
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="cf-password">
            Password
          </label>
          <div className="inputgroup">
            <input
              id="cf-password"
              className="input"
              type={reveal ? 'text' : 'password'}
              value={password}
              onChange={(event) => {
                setPassword(event.target.value)
                setPasswordTouched(true)
              }}
              placeholder={existing ? 'Unchanged' : 'password'}
              autoComplete="new-password"
              spellCheck={false}
            />
            <button
              type="button"
              className="iconbtn"
              onClick={() => setReveal((on) => !on)}
              aria-label={reveal ? 'Hide password' : 'Show password'}
            >
              <Icon name="eye" />
            </button>
            <button
              type="button"
              className="iconbtn"
              onClick={generatePassword}
              aria-label="Generate a password"
            >
              <Icon name="wand" />
            </button>
          </div>

          {password && (
            <>
              <div className="meter" aria-hidden="true">
                <span style={{ width: `${((score + 1) / 5) * 100}%` }} />
              </div>
              <p className="meter__label">{SCORE_LABELS[score]}</p>
            </>
          )}
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="cf-website">
            Website
          </label>
          <input
            id="cf-website"
            className="input"
            value={website}
            onChange={(event) => setWebsite(event.target.value)}
            placeholder="example.com"
            autoComplete="off"
          />
        </div>

        <div className="form__folderRow">
          <div className="field" style={{ flex: 1, marginBottom: 0 }}>
            <label className="label field__label" htmlFor="cf-folder">
              Folder
            </label>
            <select
              id="cf-folder"
              className="input"
              value={folderId ?? ''}
              onChange={(event) =>
                setFolderId(event.target.value === '' ? null : Number(event.target.value))
              }
            >
              <option value="">No folder</option>
              {options.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
          </div>

          <div className="field" style={{ marginBottom: 0 }}>
            <span className="label field__label">Favorite</span>
            <button
              type="button"
              className="iconbtn iconbtn--boxed"
              data-on={favorite}
              onClick={() => setFavorite((on) => !on)}
              aria-label={favorite ? 'Remove from favorites' : 'Add to favorites'}
              aria-pressed={favorite}
            >
              <Icon name={favorite ? 'star-filled' : 'star'} />
            </button>
          </div>
        </div>

        <div className="field" style={{ marginTop: 'var(--sp-4)' }}>
          <label className="label field__label" htmlFor="cf-notes">
            Notes (optional)
          </label>
          <textarea
            id="cf-notes"
            className="input"
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            placeholder="Add recovery hints, setup notes, or context."
          />
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="cf-tags">
            Tags
          </label>
          <input
            id="cf-tags"
            className="input"
            value={tagText}
            onChange={(event) => setTagText(event.target.value)}
            placeholder={`dev, finance (max ${MAX_TAGS})`}
            autoComplete="off"
            aria-invalid={tooManyTags}
            aria-describedby="cf-tags-help"
          />
          <p
            id="cf-tags-help"
            className="form__hint"
            data-error={tooManyTags}
            role={tooManyTags ? 'alert' : undefined}
          >
            {tooManyTags
              ? `That is ${tags.length} tags. A credential can have at most ${MAX_TAGS}.`
              : `${tags.length} of ${MAX_TAGS} tags used.`}
          </p>
        </div>

        {error && (
          <p className="form__hint" data-error="true" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
