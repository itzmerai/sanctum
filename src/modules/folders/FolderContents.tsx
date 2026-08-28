/**
 * What is inside a folder, shown in place (R33).
 *
 * Rendered by Folders and by Favorites instead of navigating away — opening a
 * folder should not cost you your position on the page you opened it from.
 * The credential rows are the same component the Vault uses, so reveal, copy,
 * favourite and the overflow menu behave identically here.
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router'

import { Icon } from '../../components/Icon'
import { NotePeek } from '../../components/NotePeek'
import {
  CommandError,
  clipboard,
  credentials,
  envFiles,
  notes,
  type Credential,
  type EnvFile,
  type Folder,
  type Note,
} from '../../lib/ipc'
import { parseEnv } from '../../lib/envParse'
import { EnvFileDetail } from '../envfiles/EnvFileDetail'
import { CredentialDetail } from '../vault/CredentialDetail'
import { CredentialForm } from '../vault/CredentialForm'
import { CredentialRow } from '../vault/CredentialRow'
import '../vault/vault.css'
import '../envfiles/envfiles.css'

interface Props {
  folder: Folder
  onBack: () => void
  /** Called after a change, so the caller can refresh its item counts. */
  onChanged?: () => void | Promise<void>
}

export function FolderContents({ folder, onBack, onChanged }: Props) {
  const navigate = useNavigate()
  const isNotes = folder.kind === 'notes'
  const isEnv = folder.kind === 'env'

  const [creds, setCreds] = useState<Credential[]>([])
  const [noteList, setNoteList] = useState<Note[]>([])
  const [envList, setEnvList] = useState<EnvFile[]>([])
  const [envPeek, setEnvPeek] = useState<EnvFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<Credential | null>(null)
  const [editing, setEditing] = useState<Credential | null>(null)
  const [peek, setPeek] = useState<Note | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (isEnv) {
        const all = await envFiles.list()
        setEnvList(all.filter((file) => file.folderId === folder.id))
      } else if (isNotes) {
        const all = await notes.list()
        setNoteList(all.filter((note) => note.folderId === folder.id))
      } else {
        const all = await credentials.list()
        setCreds(all.filter((item) => item.folderId === folder.id))
      }
      setError(null)
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
    } finally {
      setLoading(false)
    }
  }, [folder.id, isNotes, isEnv])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  async function refresh() {
    await load()
    await onChanged?.()
  }

  async function copyPassword(id: string) {
    try {
      const receipt = await clipboard.copyPassword(id)
      setToast(
        receipt.exclusion === 'excluded'
          ? 'Password copied. Clears in 30 seconds.'
          : 'Password copied, but Windows may keep its own copy.',
      )
    } catch {
      setToast('Could not copy the password.')
    }
  }

  const count = isEnv ? envList.length : isNotes ? noteList.length : creds.length
  const empty = count === 0

  return (
    <div>
      <header className="page__head foldc__head">
        <button className="foldc__back" onClick={onBack}>
          <Icon name="chevron-down" size={14} className="foldc__backIcon" />
          Folders
        </button>
        <div className="foldc__title">
          <span className="fold__icon" style={{ background: folder.color }} aria-hidden="true">
            <Icon name="folder" size={15} />
          </span>
          <div>
            <h1 className="page__title">{folder.name}</h1>
            <p className="page__sub">
              {isEnv ? 'Env files' : isNotes ? 'Notes' : 'Passwords'} &middot; {count} item
              {count === 1 ? '' : 's'}
            </p>
          </div>
        </div>
      </header>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : empty ? (
        <div className="card page__empty">
          <Icon name={isNotes ? 'note' : 'key'} size={22} />
          <p>Nothing filed in {folder.name} yet.</p>
        </div>
      ) : isEnv ? (
        // Read-only here: editing and deleting belong to the Env Files module,
        // so a folder cannot become a second place that owns the record.
        envPeek ? (
          <div>
            <button className="foldc__back" onClick={() => setEnvPeek(null)}>
              <Icon name="chevron-down" size={14} className="foldc__backIcon" />
              {folder.name}
            </button>
            <EnvFileDetail file={envPeek} />
          </div>
        ) : (
          <div className="card vault__list">
            {envList.map((file) => (
              <div className="row" key={file.id}>
                <button className="row__main" onClick={() => setEnvPeek(file)}>
                  <span className="row__text">
                    <span className="row__name">{file.title}</span>
                    <span className="row__note">
                      {parseEnv(file.content).keyCount} keys &middot; {file.environment}
                    </span>
                  </span>
                </button>
              </div>
            ))}
          </div>
        )
      ) : isNotes ? (
        <div className="card vault__list">
          {noteList.map((note) => (
            <div className="row" key={note.id}>
              <button className="row__main" onClick={() => setPeek(note)}>
                <span className="row__text">
                  <span className="row__name">{note.title || 'Untitled note'}</span>
                  <span className="row__note">
                    {note.body.trim().split('\n')[0] || 'No content'}
                  </span>
                </span>
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="card vault__list">
          {creds.map((item) => (
            <CredentialRow
              key={item.id}
              item={item}
              onOpen={() => setDetail(item)}
              onCopy={() => copyPassword(item.id)}
              onFavorite={async () => {
                await credentials.setFavorite('credential', item.id, !item.favorite)
                await refresh()
              }}
              onEdit={() => setEditing(item)}
              onDelete={async () => {
                await credentials.remove(item.id)
                await refresh()
              }}
            />
          ))}
        </div>
      )}

      {detail && (
        <CredentialDetail
          item={detail}
          onClose={() => setDetail(null)}
          onCopy={() => copyPassword(detail.id)}
          onEdit={() => {
            setEditing(detail)
            setDetail(null)
          }}
        />
      )}

      {editing && (
        <CredentialForm
          existing={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null)
            await refresh()
          }}
        />
      )}

      {peek && (
        <NotePeek
          note={peek}
          onClose={() => setPeek(null)}
          onOpenInNotes={() => navigate('/notes', { state: { noteId: peek.id } })}
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
