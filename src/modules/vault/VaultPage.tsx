/**
 * The Vault screen (U9: R19, R20, R21).
 *
 * Search and tag filtering happen in memory, not in SQL. Every searchable
 * field is encrypted at rest (U3), so the database cannot index them — the
 * rows are already decrypted in the store by the time the user types. At
 * personal-vault scale that is instant; if a vault ever grew past a few
 * thousand entries this is the first thing that would need revisiting.
 */
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { CommandError, type Credential, clipboard, credentials } from '../../lib/ipc'
import { useVault } from '../../store/useVault'
import { CredentialDetail } from './CredentialDetail'
import { CredentialForm } from './CredentialForm'
import { CredentialRow } from './CredentialRow'
import { CredentialCard } from './CredentialCard'
import './vault.css'

type View = 'list' | 'grid'

export function VaultPage() {
  const { credentials: items, loading, error, loadCredentials } = useVault()
  const [view, setView] = useState<View>('list')
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [detailId, setDetailId] = useState<number | null>(null)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [creating, setCreating] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    void loadCredentials()
  }, [loadCredentials])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const tags = useMemo(() => {
    const all = new Set<string>()
    for (const item of items) for (const t of item.tags) all.add(t)
    return [...all].sort()
  }, [items])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return items.filter((item) => {
      if (tag && !item.tags.includes(tag)) return false
      if (!needle) return true
      return (
        item.name.toLowerCase().includes(needle) ||
        item.username.toLowerCase().includes(needle) ||
        item.website.toLowerCase().includes(needle) ||
        item.notes.toLowerCase().includes(needle) ||
        item.tags.some((t) => t.toLowerCase().includes(needle))
      )
    })
  }, [items, query, tag])

  async function copyPassword(id: number) {
    try {
      const receipt = await clipboard.copyPassword(id)
      setToast(
        receipt.exclusion === 'excluded'
          ? 'Password copied. Clears in 30 seconds.'
          : 'Password copied, but Windows may keep its own copy in clipboard history.',
      )
    } catch (raw) {
      setToast(raw instanceof CommandError ? raw.message : 'Could not copy the password.')
    }
  }

  async function toggleFavorite(item: Credential) {
    await credentials.setFavorite('credential', item.id, !item.favorite)
    await loadCredentials()
  }

  async function remove(id: number) {
    await credentials.remove(id)
    setDetailId(null)
    await loadCredentials()
  }

  const detail = detailId === null ? null : (items.find((i) => i.id === detailId) ?? null)

  return (
    <div data-testid="route-vault">
      <header className="page__head">
        <h1 className="page__title">Vault</h1>
        <p className="page__sub">
          {items.length === 0
            ? 'Saved logins stay encrypted and organized in this local vault.'
            : `You have ${items.length} credential${items.length === 1 ? '' : 's'}. Saved logins stay encrypted and organized in this local vault.`}
        </p>
      </header>

      <div className="toolbar">
        <div className="segmented" role="group" aria-label="View">
          <button
            className="segmented__item"
            data-on={view === 'grid'}
            onClick={() => setView('grid')}
            aria-label="Grid view"
            aria-pressed={view === 'grid'}
          >
            <Icon name="grid" />
          </button>
          <button
            className="segmented__item"
            data-on={view === 'list'}
            onClick={() => setView('list')}
            aria-label="List view"
            aria-pressed={view === 'list'}
          >
            <Icon name="list" />
          </button>
        </div>

        <div className="toolbar__search">
          <Icon name="search" />
          <input
            className="toolbar__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search vault"
            aria-label="Search vault"
            spellCheck={false}
          />
        </div>

        <select
          className="input toolbar__tags"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          aria-label="Filter by tag"
        >
          <option value="">All tags</option>
          {tags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>

        <button
          className="toolbar__add"
          onClick={() => setCreating(true)}
          aria-label="New credential"
        >
          <Icon name="plus" />
        </button>
      </div>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card page__empty">
          <Icon name="key" size={22} />
          <p>
            {items.length === 0
              ? 'No credentials yet. Add your first one to get started.'
              : 'Nothing matches that search.'}
          </p>
          {items.length === 0 && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> New credential
            </button>
          )}
        </div>
      ) : view === 'list' ? (
        <div className="card vault__list">
          {visible.map((item) => (
            <CredentialRow
              key={item.id}
              item={item}
              onOpen={() => setDetailId(item.id)}
              onCopy={() => copyPassword(item.id)}
              onFavorite={() => toggleFavorite(item)}
              onEdit={() => setEditing(item)}
              onDelete={() => remove(item.id)}
            />
          ))}
        </div>
      ) : (
        <div className="vault__grid">
          {visible.map((item) => (
            <CredentialCard
              key={item.id}
              item={item}
              onOpen={() => setDetailId(item.id)}
              onCopy={() => copyPassword(item.id)}
              onFavorite={() => toggleFavorite(item)}
              onEdit={() => setEditing(item)}
              onDelete={() => remove(item.id)}
            />
          ))}
        </div>
      )}

      {detail && (
        <CredentialDetail
          item={detail}
          onClose={() => setDetailId(null)}
          onCopy={() => copyPassword(detail.id)}
          onEdit={() => {
            setDetailId(null)
            setEditing(detail)
          }}
        />
      )}

      {(creating || editing) && (
        <CredentialForm
          existing={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await loadCredentials()
          }}
        />
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
