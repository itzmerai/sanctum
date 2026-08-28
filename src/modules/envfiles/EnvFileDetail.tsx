/**
 * One env file, read (U6: R8, R9, R10, R11).
 *
 * Values are masked until asked for, one key at a time — an env file opened in
 * a screen share should not put a production database URI on the wall.
 *
 * Copying the whole file always sends the **stored text**, never a rebuild
 * from the parsed rows. That is the difference between pasting a file back
 * into a checkout and pasting something that merely resembles it.
 */
import { useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { parseEnv } from '../../lib/envParse'
import { clipboard, type EnvFile } from '../../lib/ipc'

interface Props {
  file: EnvFile
  /** Omitted where the file is shown read-only, as inside a folder. */
  onEdit?: () => void
  onDelete?: () => void
}

export function EnvFileDetail({ file, onEdit, onDelete }: Props) {
  const [revealed, setRevealed] = useState<Set<number>>(new Set())
  const [copied, setCopied] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const parsed = useMemo(() => parseEnv(file.content), [file.content])

  // A new selection must not inherit the previous file's revealed rows.
  const [shownFor, setShownFor] = useState(file.id)
  if (shownFor !== file.id) {
    setShownFor(file.id)
    setRevealed(new Set())
    setCopied(null)
  }

  function toggle(index: number) {
    setRevealed((current) => {
      const next = new Set(current)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  async function copy(text: string, label: string) {
    setError(null)
    try {
      await clipboard.copyText(text)
      setCopied(label)
      window.setTimeout(() => setCopied((was) => (was === label ? null : was)), 1600)
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    }
  }

  return (
    <section className="envdetail">
      <header className="envdetail__head">
        <div className="envdetail__title">
          <h2>{file.title}</h2>
          <span className={`chip chip--${file.environment}`}>{file.environment}</span>
        </div>
        <div className="envdetail__actions">
          <button className="btn" onClick={() => void copy(file.content, 'file')}>
            <Icon name="copy" size={14} /> {copied === 'file' ? 'Copied' : 'Copy file'}
          </button>
          {onEdit && (
            <button className="btn" onClick={onEdit}>
              <Icon name="edit" size={14} /> Edit
            </button>
          )}
          {onDelete && (
            <button className="btn" onClick={onDelete}>
              <Icon name="trash" size={14} /> Delete
            </button>
          )}
        </div>
      </header>

      {error && (
        <p className="form__hint" data-error="true" role="alert">
          {error}
        </p>
      )}

      {parsed.keyCount === 0 ? (
        <>
          <p className="envdetail__notice">
            No <code>KEY=value</code> lines were recognised here, so the file is shown as it was
            saved. Copying still returns it exactly.
          </p>
          <pre className="envdetail__raw">{file.content}</pre>
        </>
      ) : (
        <ul className="envrows">
          {parsed.entries.map((entry, index) =>
            entry.kind === 'opaque' ? (
              <li key={index} className="envrow envrow--opaque">
                <span className="envrow__opaque">{entry.text || ' '}</span>
              </li>
            ) : (
              <li key={index} className="envrow">
                <span className="envrow__key">{entry.key}</span>
                <span className="envrow__value" data-revealed={revealed.has(index)}>
                  {revealed.has(index) ? entry.value : '•'.repeat(Math.min(entry.value.length, 24))}
                </span>
                <button
                  type="button"
                  className="envrow__btn"
                  onClick={() => toggle(index)}
                  aria-label={revealed.has(index) ? `Hide ${entry.key}` : `Show ${entry.key}`}
                >
                  <Icon name="eye" size={14} />
                </button>
                <button
                  type="button"
                  className="envrow__btn"
                  onClick={() => void copy(entry.value, entry.key)}
                  aria-label={`Copy ${entry.key}`}
                >
                  <Icon name="copy" size={14} />
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
