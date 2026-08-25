/**
 * The activity log (U19: R35).
 *
 * Records that something happened and what it was called — never what
 * changed. A log that stored previous values would be an unversioned second
 * copy of the vault's history sitting beside it.
 */
import { useEffect, useState } from 'react'

import { Icon, type IconName } from '../../components/Icon'
import { CommandError, activity, type ActivityEntry } from '../../lib/ipc'
import { formatRelative } from '../../lib/format'
import './activity.css'

const ENTITY_ICON: Record<string, IconName> = {
  credential: 'key',
  note: 'note',
  task: 'task',
  income: 'income',
  folder: 'folder',
}

const ENTITY_LABEL: Record<string, string> = {
  credential: 'Credential',
  note: 'Note',
  task: 'Task',
  income: 'Income',
  folder: 'Folder',
}

export function ActivityPage() {
  const [entries, setEntries] = useState<ActivityEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setEntries(await activity.list())
      setError(null)
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  async function clear() {
    if (!confirming) {
      setConfirming(true)
      return
    }
    await activity.clear()
    setConfirming(false)
    await load()
  }

  return (
    <div data-testid="route-activity">
      <header className="page__head activity__head">
        <div>
          <h1 className="page__title">Activity Log</h1>
          <p className="page__sub">
            Review local vault changes. This log never leaves this device.
          </p>
        </div>
        <button
          className="btn activity__clear"
          data-confirming={confirming}
          onClick={clear}
          disabled={entries.length === 0}
        >
          <Icon name="trash" />
          {confirming ? 'Click again to clear' : 'Clear Activity Log'}
        </button>
      </header>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Loading…</p>
        </div>
      ) : entries.length === 0 ? (
        <div className="card page__empty">
          <Icon name="history" size={22} />
          <p>Nothing has changed yet. Edits you make will show up here.</p>
        </div>
      ) : (
        <div className="card activity__list">
          {entries.map((entry) => (
            <div className="activity__row" key={entry.id}>
              <span className="activity__icon" aria-hidden="true">
                <Icon name={ENTITY_ICON[entry.entityType] ?? 'note'} />
              </span>
              <span className="activity__text">
                <span className="activity__title">
                  {ENTITY_LABEL[entry.entityType] ?? entry.entityType} {entry.action}
                </span>
                <span className="activity__subject">{entry.subject || '—'}</span>
              </span>
              <time className="activity__time" dateTime={new Date(entry.createdAt).toISOString()}>
                {formatRelative(entry.createdAt)}
              </time>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
