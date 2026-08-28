/**
 * Env Files (U5: R5, R6, R7, R12, R13).
 *
 * Vault's layout, one module over: search, a filter where Vault has its tag
 * filter, and a `+` button. Environment is a field on the record rather than a
 * folder, so one project's three files sit together in the list (KD2).
 *
 * The textarea's value is sent to the vault unmodified. No trim, no line
 * ending normalisation, no reformatting — a `.env` that comes back different
 * from what went in is a bug, not a tidy-up (KD3).
 */
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { parseEnv } from '../../lib/envParse'
import { formatDateTime } from '../../lib/format'
import {
  CommandError,
  ENV_ENVIRONMENTS,
  envFiles,
  folders,
  hasBackend,
  type EnvEnvironment,
  type EnvFile,
  readEnvText,
  type Folder,
} from '../../lib/ipc'
import { EnvFileDetail } from './EnvFileDetail'
import './envfiles.css'

type Draft = {
  id: string | null
  title: string
  content: string
  environment: EnvEnvironment
  folderId: string | null
}

const BLANK: Draft = {
  id: null,
  title: '',
  content: '',
  environment: 'local',
  folderId: null,
}

export function EnvFilesPage() {
  const [items, setItems] = useState<EnvFile[]>([])
  const [envFolders, setEnvFolders] = useState<Folder[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [environment, setEnvironment] = useState<EnvEnvironment | 'all'>('all')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<EnvFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load(selectAfter?: string) {
    try {
      const list = await envFiles.list()
      setItems(list)
      setError(null)
      if (selectAfter !== undefined) setSelectedId(selectAfter)
      return list
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
      return []
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    void folders
      .list('env')
      .then(setEnvFolders)
      .catch(() => setEnvFolders([]))
  }, [])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((file) => {
      if (environment !== 'all' && file.environment !== environment) return false
      // Only the title is searchable. Values must never be matched against.
      return needle === '' || file.title.toLowerCase().includes(needle)
    })
  }, [items, query, environment])

  const selected = useMemo(
    () => items.find((file) => file.id === selectedId) ?? null,
    [items, selectedId],
  )

  async function importFile() {
    if (!hasBackend()) return
    try {
      const { open } = await import('@tauri-apps/plugin-dialog')
      const picked = await open({
        multiple: false,
        filters: [{ name: 'Env files', extensions: ['env', 'txt', ''] }],
      })
      if (typeof picked !== 'string') return

      const text = await readEnvText(picked)
      const name = picked.split(/[\\/]/).pop() ?? ''
      setDraft((current) =>
        current
          ? { ...current, content: text, title: current.title || name.replace(/^\.env\.?/, '') }
          : current,
      )
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    }
  }

  async function save() {
    if (!draft) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        title: draft.title,
        content: draft.content,
        environment: draft.environment,
        folderId: draft.folderId,
      }
      let id = draft.id
      if (id) await envFiles.update(id, input)
      else id = await envFiles.create(input)
      // Clear the filters before reloading: a stale search or environment
      // filter would hide the record that was just saved.
      setQuery('')
      setEnvironment('all')
      setDraft(null)
      await load(id)
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    if (!confirmDelete) return
    setBusy(true)
    try {
      await envFiles.remove(confirmDelete.id)
      setConfirmDelete(null)
      if (selectedId === confirmDelete.id) setSelectedId(null)
      await load()
    } catch (raw) {
      setError(raw instanceof Error ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="page envpage">
      <header className="page__head">
        <div>
          <h1 className="page__title">Env Files</h1>
          <p className="page__sub">
            {items.length === 0
              ? 'Keep each project’s .env here instead of on disk.'
              : `${items.length} file${items.length === 1 ? '' : 's'} across your projects.`}
          </p>
        </div>
      </header>

      <div className="toolbar">
        <div className="toolbar__search">
          <Icon name="search" size={14} />
          <input
            className="toolbar__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search env files"
            aria-label="Search env files"
          />
        </div>

        <select
          className="input"
          value={environment}
          onChange={(event) => setEnvironment(event.target.value as EnvEnvironment | 'all')}
          aria-label="Filter by environment"
        >
          <option value="all">All environments</option>
          {ENV_ENVIRONMENTS.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>

        <button className="btn btn-primary" onClick={() => setDraft({ ...BLANK })}>
          <Icon name="plus" size={14} />
          <span className="sr-only">New env file</span>
        </button>
      </div>

      {error && (
        <p className="form__hint" data-error="true" role="alert">
          {error}
        </p>
      )}

      <div className="envpage__body">
        <ul className="envlist">
          {loading && <li className="envlist__empty">Loading&hellip;</li>}
          {!loading && visible.length === 0 && (
            <li className="envlist__empty">
              {items.length === 0 ? 'Nothing saved yet.' : 'No env files match.'}
            </li>
          )}
          {visible.map((file) => (
            <li key={file.id}>
              <button
                type="button"
                className="envlist__row"
                data-active={file.id === selectedId}
                onClick={() => setSelectedId(file.id)}
              >
                <span className="envlist__name">{file.title}</span>
                <span className="envlist__meta">
                  {parseEnv(file.content).keyCount} keys &middot; {formatDateTime(file.updatedAt)}
                </span>
                <span className={`chip chip--${file.environment}`}>{file.environment}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="envpage__detail">
          {selected ? (
            <EnvFileDetail
              file={selected}
              onEdit={() =>
                setDraft({
                  id: selected.id,
                  title: selected.title,
                  content: selected.content,
                  environment: selected.environment,
                  folderId: selected.folderId,
                })
              }
              onDelete={() => setConfirmDelete(selected)}
            />
          ) : (
            <p className="envpage__hint">Select an env file to see its keys.</p>
          )}
        </div>
      </div>

      {draft && (
        <Modal
          title={draft.id ? 'Edit env file' : 'New env file'}
          onClose={() => setDraft(null)}
          width={620}
          footer={
            <>
              <button className="btn" onClick={() => setDraft(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </>
          }
        >
          <label className="field">
            <span className="label">Project</span>
            <input
              className="input"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Acme Storefront"
              maxLength={80}
            />
          </label>

          <div className="field field--row">
            <label className="field">
              <span className="label">Environment</span>
              <select
                className="input"
                value={draft.environment}
                onChange={(event) =>
                  setDraft({ ...draft, environment: event.target.value as EnvEnvironment })
                }
              >
                {ENV_ENVIRONMENTS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span className="label">Folder</span>
              <select
                className="input"
                value={draft.folderId ?? ''}
                onChange={(event) =>
                  setDraft({ ...draft, folderId: event.target.value || null })
                }
              >
                <option value="">No folder</option>
                {envFolders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="label label--withAction">
              File contents
              {hasBackend() && (
                <button type="button" className="btn" onClick={() => void importFile()}>
                  <Icon name="folder" size={13} /> Import .env
                </button>
              )}
            </span>
            <textarea
              className="input envform__area"
              value={draft.content}
              onChange={(event) => setDraft({ ...draft, content: event.target.value })}
              placeholder={'# paste your .env here\nDATABASE_URL=...'}
              spellCheck={false}
              rows={14}
            />
          </label>
          <p className="form__hint">
            Saved exactly as written &mdash; comments, blank lines and key order are kept.
          </p>
        </Modal>
      )}

      {confirmDelete && (
        <Modal
          title="Delete env file"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirmDelete(null)} disabled={busy}>
                Cancel
              </button>
              <button className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
                Delete
              </button>
            </>
          }
        >
          <p>
            Delete <strong>{confirmDelete.title}</strong> ({confirmDelete.environment})? The stored
            file is removed from this vault and cannot be recovered without a backup.
          </p>
        </Modal>
      )}
    </div>
  )
}
