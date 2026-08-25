/**
 * Favorites (U18: R34).
 *
 * Aggregates starred folders, credentials and notes behind one type filter.
 * The star lives in its own table rather than as a column on each entity, so
 * this is one query per type instead of a UNION that grows with every module.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router'

import { Icon, type IconName } from '../../components/Icon'
import { CommandError, credentials, folders, notes } from '../../lib/ipc'
import './favorites.css'

type Filter = 'all' | 'folders' | 'passwords' | 'notes'

interface FavoriteItem {
  key: string
  id: number
  type: 'folder' | 'credential' | 'note'
  icon: IconName
  title: string
  subtitle: string
  color?: string
  route: string
}

export function FavoritesPage() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<Filter>('all')
  const [items, setItems] = useState<FavoriteItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      const [passwordFolders, noteFolders, creds, noteList] = await Promise.all([
        folders.list('passwords'),
        folders.list('notes'),
        credentials.list(),
        notes.list(),
      ])

      const collected: FavoriteItem[] = []

      for (const folder of [...passwordFolders, ...noteFolders]) {
        if (!folder.favorite) continue
        collected.push({
          key: `folder-${folder.id}`,
          id: folder.id,
          type: 'folder',
          icon: 'folder',
          title: folder.name,
          subtitle: `${folder.kind === 'notes' ? 'Notes' : 'Passwords'} · ${folder.itemCount} item${folder.itemCount === 1 ? '' : 's'}`,
          color: folder.color,
          route: '/folders',
        })
      }

      for (const credential of creds) {
        if (!credential.favorite) continue
        collected.push({
          key: `credential-${credential.id}`,
          id: credential.id,
          type: 'credential',
          icon: 'key',
          title: credential.name,
          subtitle: credential.username || 'Credential',
          route: '/vault',
        })
      }

      for (const note of noteList) {
        if (!note.favorite) continue
        collected.push({
          key: `note-${note.id}`,
          id: note.id,
          type: 'note',
          icon: 'note',
          title: note.title || 'Untitled note',
          subtitle: 'Note',
          route: '/notes',
        })
      }

      setItems(collected)
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

  const visible = useMemo(() => {
    if (filter === 'all') return items
    const want = filter === 'folders' ? 'folder' : filter === 'passwords' ? 'credential' : 'note'
    return items.filter((item) => item.type === want)
  }, [items, filter])

  async function unstar(item: FavoriteItem) {
    await credentials.setFavorite(item.type, item.id, false)
    await load()
  }

  return (
    <div data-testid="route-favorites">
      <header className="page__head fav__head">
        <div>
          <h1 className="page__title">
            Favorites
            <select
              className="input fav__filter"
              value={filter}
              onChange={(event) => setFilter(event.target.value as Filter)}
              aria-label="Filter favorites"
            >
              <option value="all">All</option>
              <option value="folders">Folders</option>
              <option value="passwords">Passwords</option>
              <option value="notes">Notes</option>
            </select>
          </h1>
          <p className="page__sub">Star folders, passwords, and notes you want close by.</p>
        </div>
      </header>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="card page__empty">
          <Icon name="star" size={22} />
          <p>
            {items.length === 0
              ? 'Nothing starred yet. Use the star on any credential, note or folder.'
              : 'Nothing starred of that type.'}
          </p>
        </div>
      ) : (
        <div className="fav__grid">
          {visible.map((item) => (
            <article className="fav__card" key={item.key}>
              <span
                className="fold__icon"
                style={item.color ? { background: item.color } : undefined}
                data-plain={item.color === undefined}
                aria-hidden="true"
              >
                <Icon name={item.icon} size={15} />
              </span>
              <button className="fav__text" onClick={() => navigate(item.route)}>
                <span className="fold__name">{item.title}</span>
                <span className="fold__items">{item.subtitle}</span>
              </button>
              <button
                className="iconbtn"
                data-on="true"
                onClick={() => void unstar(item)}
                aria-label={`Remove ${item.title} from favorites`}
              >
                <Icon name="star-filled" />
              </button>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
