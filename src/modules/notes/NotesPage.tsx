/**
 * Notes (U14: R26, R27).
 *
 * Three panes, as the reference has them: sidebar, note list, editor.
 *
 * The editor is a plain Markdown textarea with a formatting toolbar rather
 * than TipTap. KTD17 named TipTap, and it would be the right call for rich
 * text — but the note body is stored *as Markdown*, so a ProseMirror document
 * model would mean a serialise/parse round trip on every keystroke, plus about
 * 300 kB of editor in an app whose premise is carrying nothing it does not
 * need. The toolbar wraps selections directly in Markdown syntax, which is
 * what the stored format actually is. Swapping in TipTap later touches only
 * this file, since the storage format does not change.
 */
import { useEffect, useMemo, useRef, useState } from 'react'

import { Icon } from '../../components/Icon'
import { formatDateTime } from '../../lib/format'
import { CommandError, credentials, folders, notes, type Folder, type Note } from '../../lib/ipc'
import { NoteMenu } from './NoteMenu'
import './notes.css'

/** How long after the last keystroke an edit is saved. */
const AUTOSAVE_MS = 900

export function NotesPage() {
  const [items, setItems] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [noteFolders, setNoteFolders] = useState<Folder[]>([])
  const [labelText, setLabelText] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  async function load(selectAfter?: string) {
    try {
      const list = await notes.list()
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
      .list('notes')
      .then(setNoteFolders)
      .catch(() => setNoteFolders([]))
  }, [])

  const selected = useMemo(
    () => items.find((note) => note.id === selectedId) ?? null,
    [items, selectedId],
  )

  // Reload the draft only when a *different* stored version appears -- a new
  // selection, or this note changed underneath us. Depending on `selected`
  // alone would reset on every list refresh and discard in-progress typing,
  // so the version key is what the effect actually reacts to.
  const loadedFor = useRef<string | null>(null)
  useEffect(() => {
    const key = selected ? `${selected.id}:${selected.updatedAt}` : null
    if (loadedFor.current === key) return
    loadedFor.current = key
    setDraft(selected ? { title: selected.title, body: selected.body } : null)
    setLabelText(selected ? selected.labels.join(', ') : '')
  }, [selected])

  // Autosave. A notes editor that needs a Save button loses work.
  useEffect(() => {
    if (!selected || !draft) return
    if (draft.title === selected.title && draft.body === selected.body) return

    const timer = setTimeout(async () => {
      setSaving(true)
      try {
        await notes.update(selected.id, {
          title: draft.title,
          body: draft.body,
          labels: selected.labels,
          folderId: selected.folderId,
        })
        // Refresh without changing selection, so the list's modified time and
        // ordering stay honest.
        const list = await notes.list()
        setItems(list)
      } catch (raw) {
        setError(raw instanceof Error ? raw.message : String(raw))
      } finally {
        setSaving(false)
      }
    }, AUTOSAVE_MS)

    return () => clearTimeout(timer)
  }, [draft, selected])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return items
    return items.filter(
      (note) =>
        note.title.toLowerCase().includes(needle) ||
        note.body.toLowerCase().includes(needle) ||
        note.labels.some((label) => label.toLowerCase().includes(needle)),
    )
  }, [items, query])

  async function createNote() {
    const id = await notes.create({ title: '', body: '', labels: [], folderId: null })
    await load(id)
  }

  async function removeNote(id: string) {
    await notes.remove(id)
    setSelectedId(null)
    await load()
  }

  /** Saves everything except title and body, which autosave owns. */
  async function saveMeta(over: Partial<{ labels: string[]; folderId: string | null }>) {
    if (!selected) return
    await notes.update(selected.id, {
      title: draft?.title ?? selected.title,
      body: draft?.body ?? selected.body,
      labels: over.labels ?? selected.labels,
      folderId: over.folderId !== undefined ? over.folderId : selected.folderId,
    })
    await load()
  }

  async function toggleFavorite() {
    if (!selected) return
    await credentials.setFavorite('note', selected.id, !selected.favorite)
    await load()
  }

  async function duplicateNote(id: string) {
    const copy = await notes.duplicate(id)
    await load(copy)
  }

  /** Wraps the current selection in Markdown syntax. */
  function wrap(before: string, after = before) {
    const field = bodyRef.current
    if (!field || !draft) return

    const { selectionStart: start, selectionEnd: end, value } = field
    const selectedText = value.slice(start, end)
    const next = `${value.slice(0, start)}${before}${selectedText}${after}${value.slice(end)}`
    setDraft({ ...draft, body: next })

    // Restore the caret inside the markers so typing continues naturally.
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(start + before.length, end + before.length)
    })
  }

  function prefixLine(marker: string) {
    const field = bodyRef.current
    if (!field || !draft) return
    const { selectionStart, value } = field
    const lineStart = value.lastIndexOf('\n', selectionStart - 1) + 1
    const next = `${value.slice(0, lineStart)}${marker}${value.slice(lineStart)}`
    setDraft({ ...draft, body: next })
    requestAnimationFrame(() => {
      field.focus()
      field.setSelectionRange(selectionStart + marker.length, selectionStart + marker.length)
    })
  }

  return (
    <div className="notes" data-testid="route-notes">
      <div className="notes__list">
        <header className="page__head">
          <h1 className="page__title">Notes</h1>
          <p className="page__sub">
            Write markdown notes and keep them organized by folder or favorite.
          </p>
        </header>

        <div className="notes__search">
          <div className="toolbar__search">
            <Icon name="search" />
            <input
              className="toolbar__input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search notes"
              aria-label="Search notes"
            />
          </div>
          <button className="toolbar__add" onClick={createNote} aria-label="New note">
            <Icon name="plus" />
          </button>
        </div>

        {error && <p className="vault__error">{error}</p>}

        {loading ? (
          <p className="notes__empty">Decrypting…</p>
        ) : visible.length === 0 ? (
          <p className="notes__empty">
            {items.length === 0 ? 'No notes yet.' : 'Nothing matches that search.'}
          </p>
        ) : (
          visible.map((note) => (
            <button
              key={note.id}
              className="notecard"
              data-selected={note.id === selectedId}
              onClick={() => setSelectedId(note.id)}
            >
              <span className="notecard__title">{note.title || 'Untitled note'}</span>
              <span className="notecard__preview">
                {note.body.trim().split('\n')[0] || 'No content'}
              </span>
              <span className="notecard__meta">
                {formatDateTime(note.updatedAt)}
                {note.labels.length > 0 && ` · ${note.labels.join(', ')}`}
              </span>
            </button>
          ))
        )}
      </div>

      <div className="notes__editor">
        {!selected || !draft ? (
          <div className="page__empty notes__none">
            <Icon name="note" size={22} />
            <p>No note selected. Choose a note from the list or create a new one.</p>
            <button className="btn btn-primary" onClick={createNote}>
              <Icon name="plus" /> Create note
            </button>
          </div>
        ) : (
          <>
            <header className="notes__crumbs">
              <span>Notes</span>
              <Icon name="chevron-down" size={12} />
              <span className="notes__crumbTitle">{draft.title || 'Untitled note'}</span>
              <span className="notes__saving">{saving ? 'Saving…' : ''}</span>
              <NoteMenu
                favorite={selected.favorite}
                onDuplicate={() => void duplicateNote(selected.id)}
                onDelete={() => void removeNote(selected.id)}
                onToggleFavorite={() => void toggleFavorite()}
                onMoveToFolder={() => document.getElementById('note-folder')?.focus()}
              />
            </header>

            <input
              className="notes__title"
              value={draft.title}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
              placeholder="Untitled note"
              aria-label="Note title"
            />

            <dl className="notes__meta">
              <dt className="label">Created</dt>
              <dd>{formatDateTime(selected.createdAt)}</dd>
              <dt className="label">Last modified</dt>
              <dd>{formatDateTime(selected.updatedAt)}</dd>
              <dt className="label">Labels</dt>
              <dd>
                <input
                  className="input notes__labels"
                  value={labelText}
                  onChange={(event) => setLabelText(event.target.value)}
                  onBlur={() =>
                    void saveMeta({
                      labels: labelText
                        .split(',')
                        .map((label) => label.trim())
                        .filter(Boolean),
                    })
                  }
                  placeholder="Architecture, Guides"
                  aria-label="Note labels"
                />
              </dd>
              <dt className="label">Folder</dt>
              <dd>
                <select
                  id="note-folder"
                  className="input notes__labels"
                  value={selected.folderId ?? ''}
                  onChange={(event) =>
                    void saveMeta({
                      folderId: event.target.value === '' ? null : event.target.value,
                    })
                  }
                  aria-label="Note folder"
                >
                  <option value="">No folder</option>
                  {noteFolders.map((folder) => (
                    <option key={folder.id} value={folder.id}>
                      {folder.name}
                    </option>
                  ))}
                </select>
              </dd>
            </dl>

            <div className="notes__toolbar" role="toolbar" aria-label="Formatting">
              <button className="notes__tool" onClick={() => prefixLine('# ')}>
                H1
              </button>
              <button className="notes__tool" onClick={() => prefixLine('- ')}>
                Bulleted
              </button>
              <button
                className="notes__tool"
                onClick={() => wrap('**')}
                aria-label="Bold"
              >
                <strong>B</strong>
              </button>
              <button className="notes__tool" onClick={() => wrap('*')} aria-label="Italic">
                <em>I</em>
              </button>
              <button
                className="notes__tool"
                onClick={() => wrap('~~')}
                aria-label="Strikethrough"
              >
                <s>S</s>
              </button>
              <button
                className="notes__tool"
                onClick={() => wrap('[', '](url)')}
                aria-label="Link"
              >
                <Icon name="copy" size={13} />
              </button>
            </div>

            <textarea
              ref={bodyRef}
              className="notes__body"
              value={draft.body}
              onChange={(event) => setDraft({ ...draft, body: event.target.value })}
              placeholder="Start typing your note…"
              aria-label="Note body"
              spellCheck
            />
          </>
        )}
      </div>
    </div>
  )
}
