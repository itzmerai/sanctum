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
import { NotePeek } from '../../components/NotePeek'
import {
  CommandError,
  clipboard,
  credentials,
  folders,
  notes,
  type Credential,
  type Folder,
  type Note,
} from '../../lib/ipc'
import { FolderContents } from '../folders/FolderContents'
import { CredentialDetail } from '../vault/CredentialDetail'
import './favorites.css'

type Filter = 'all' | 'folders' | 'passwords' | 'notes'

interface FavoriteItem {
  key: string
  id: string
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
  // Everything opens in place: a favourite is a shortcut to the thing, not a
  // shortcut to the tab the thing lives in.
  const [openFolder, setOpenFolder] = useState<Folder | null>(null)
  const [openCredential, setOpenCredential] = useState<Credential | null>(null)
  const [openNote, setOpenNote] = useState<Note | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  // Kept so an opened item can be found again without another round trip.
  const [sources, setSources] = useState<{
    folders: Folder[]
    credentials: Credential[]
    notes: Note[]
  }>({ folders: [], credentials: [], notes: [] })

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
      setSources({
        folders: [...passwordFolders, ...noteFolders],
        credentials: creds,
        notes: noteList,
      })
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

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const visible = useMemo(() => {
    if (filter === 'all') return items
    const want = filter === 'folders' ? 'folder' : filter === 'passwords' ? 'credential' : 'note'
    return items.filter((item) => item.type === want)
  }, [items, filter])

  /** Opens the favourited thing here, rather than jumping to its tab. */
  function openItem(item: FavoriteItem) {
    if (item.type === 'folder') {
      const folder = sources.folders.find((f) => f.id === item.id)
      if (folder) setOpenFolder(folder)
    } else if (item.type === 'credential') {
      const credential = sources.credentials.find((c) => c.id === item.id)
      if (credential) setOpenCredential(credential)
    } else {
      const note = sources.notes.find((n) => n.id === item.id)
      if (note) setOpenNote(note)
    }
  }

  async function unstar(item: FavoriteItem) {
    await credentials.setFavorite(item.type, item.id, false)
    await load()
  }

  if (openFolder) {
    return (
      <div data-testid="route-favorites">
        <FolderContents
          folder={openFolder}
          onBack={() => setOpenFolder(null)}
          onChanged={load}
        />
      </div>
    )
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
              <button className="fav__text" onClick={() => openItem(item)}>
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

      {openCredential && (
        <CredentialDetail
          item={openCredential}
          onClose={() => setOpenCredential(null)}
          onCopy={async () => {
            try {
              const receipt = await clipboard.copyPassword(openCredential.id)
              setToast(
                receipt.exclusion === 'excluded'
                  ? 'Password copied. Clears in 30 seconds.'
                  : 'Password copied, but Windows may keep its own copy.',
              )
            } catch {
              setToast('Could not copy the password.')
            }
          }}
          onEdit={() => navigate('/vault')}
        />
      )}

      {openNote && (
        <NotePeek
          note={openNote}
          onClose={() => setOpenNote(null)}
          onOpenInNotes={() => navigate('/notes', { state: { noteId: openNote.id } })}
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
