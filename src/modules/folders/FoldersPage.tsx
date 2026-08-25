/**
 * Folders (U18: R33).
 *
 * Two tabs, Passwords and Notes, because a credential must not be filed into a
 * notes folder — the `kind` column enforces that in the store rather than
 * leaving it to the UI.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { CommandError, credentials, folders, type Folder } from '../../lib/ipc'
import './folders.css'

/** The palette from the reference's colour picker. */
export const FOLDER_COLORS = [
  '#e8734a',
  '#4a7fc1',
  '#4aa86a',
  '#8b6ec9',
  '#e0a63c',
  '#d64550',
  '#4a9c9c',
  '#8a8a80',
]

type Kind = 'passwords' | 'notes'

export function FoldersPage() {
  const navigate = useNavigate()
  const [kind, setKind] = useState<Kind>('passwords')
  const [items, setItems] = useState<Folder[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Folder | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (which: Kind) => {
    setLoading(true)
    try {
      setItems(await folders.list(which))
      setError(null)
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(kind)
  }, [kind, load])

  async function toggleFavorite(folder: Folder) {
    await credentials.setFavorite('folder', folder.id, !folder.favorite)
    await load(kind)
  }

  async function remove(id: number) {
    await folders.remove(id)
    await load(kind)
  }

  return (
    <div data-testid="route-folders">
      <header className="page__head fold__head">
        <div>
          <h1 className="page__title">
            Folders
            <span className="fold__tabs">
              <button
                className="fold__tab"
                data-on={kind === 'passwords'}
                onClick={() => setKind('passwords')}
              >
                Passwords
              </button>
              <button
                className="fold__tab"
                data-on={kind === 'notes'}
                onClick={() => setKind('notes')}
              >
                Notes
              </button>
            </span>
            <span className="fold__count">
              · {items.length} folder{items.length === 1 ? '' : 's'}
            </span>
          </h1>
          <p className="page__sub">
            Keep credentials and notes grouped in color-coded folders.
          </p>
        </div>
        <button className="toolbar__add" onClick={() => setCreating(true)} aria-label="New folder">
          <Icon name="plus" />
        </button>
      </header>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card page__empty">
          <Icon name="folder" size={22} />
          <p>No {kind === 'notes' ? 'note' : 'password'} folders yet.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> New folder
          </button>
        </div>
      ) : (
        <div className="fold__grid">
          {items.map((folder) => (
            <article className="fold__card" key={folder.id}>
              <span className="fold__icon" style={{ background: folder.color }} aria-hidden="true">
                <Icon name="folder" size={15} />
              </span>
              <button
                className="fold__text"
                onClick={() =>
                  navigate(kind === 'notes' ? '/notes' : '/vault', {
                    state: { folderId: folder.id, folderName: folder.name },
                  })
                }
                aria-label={`Open ${folder.name}`}
              >
                <span className="fold__name">{folder.name}</span>
                <span className="fold__items">
                  {folder.itemCount} item{folder.itemCount === 1 ? '' : 's'}
                  {folder.favorite && (
                    <Icon name="star-filled" size={11} className="fold__star" />
                  )}
                </span>
              </button>
              <FolderMenu
                folder={folder}
                onRename={() => setEditing(folder)}
                onFavorite={() => void toggleFavorite(folder)}
                onDelete={() => void remove(folder.id)}
              />
            </article>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <FolderForm
          existing={editing}
          kind={kind}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await load(kind)
          }}
        />
      )}
    </div>
  )
}

function FolderMenu({
  folder,
  onRename,
  onFavorite,
  onDelete,
}: {
  folder: Folder
  onRename: () => void
  onFavorite: () => void
  onDelete: () => void
}) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    if (!open) return
    function away() {
      setOpen(false)
      setConfirming(false)
    }
    // A click anywhere else closes it; the buttons stop propagation.
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [open])

  return (
    <div className="rowmenu" onClick={(event) => event.stopPropagation()}>
      <button
        className="iconbtn"
        onClick={() => setOpen((on) => !on)}
        aria-label={`More actions for ${folder.name}`}
        aria-expanded={open}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className="rowmenu__panel" role="menu">
          <button className="rowmenu__item" role="menuitem" onClick={() => { setOpen(false); onRename() }}>
            <Icon name="edit" /> Rename
          </button>
          <button className="rowmenu__item" role="menuitem" onClick={() => { setOpen(false); onFavorite() }}>
            <Icon name={folder.favorite ? 'star-filled' : 'star'} />
            {folder.favorite ? 'Remove from favorites' : 'Add to favorites'}
          </button>
          <button className="rowmenu__item" role="menuitem" onClick={() => { setOpen(false); onRename() }}>
            <Icon name="settings" /> Change color
          </button>
          <button
            className="rowmenu__item rowmenu__item--danger"
            role="menuitem"
            onClick={() => {
              if (!confirming) {
                setConfirming(true)
                return
              }
              setOpen(false)
              onDelete()
            }}
          >
            <Icon name="trash" /> {confirming ? 'Click again to delete' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

function FolderForm({
  existing,
  kind,
  onClose,
  onSaved,
}: {
  existing: Folder | null
  kind: Kind
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [name, setName] = useState(existing?.name ?? '')
  const [color, setColor] = useState(existing?.color ?? FOLDER_COLORS[0]!)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (name.trim().length === 0 || busy) return

    setBusy(true)
    setError(null)
    try {
      if (existing) await folders.update(existing.id, name.trim(), color)
      else await folders.create(kind, name.trim(), color)
      await onSaved()
    } catch (raw) {
      setError(raw instanceof CommandError ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={existing ? 'Edit folder' : 'New folder'}
      onClose={onClose}
      width={360}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="folder-form"
            className="btn btn-primary"
            disabled={name.trim().length === 0 || busy}
          >
            Save
          </button>
        </>
      }
    >
      <form id="folder-form" onSubmit={save}>
        <div className="field">
          <label className="label field__label" htmlFor="ff-name">
            Name
          </label>
          <input
            id="ff-name"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Client Projects"
            required
            autoFocus
          />
        </div>

        <div className="field">
          <span className="label field__label">Color</span>
          <div className="fold__swatches">
            {FOLDER_COLORS.map((value) => (
              <button
                key={value}
                type="button"
                className="fold__swatch"
                style={{ background: value }}
                data-on={value === color}
                onClick={() => setColor(value)}
                aria-label={`Colour ${value}`}
                aria-pressed={value === color}
              />
            ))}
          </div>
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
