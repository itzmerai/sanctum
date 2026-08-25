/**
 * A read-only look at a note, without leaving the page you are on.
 *
 * Used by Folders and Favorites so opening a note there shows it in place
 * rather than navigating to the Notes tab and losing your position. Editing
 * still happens in Notes — this is a peek, and the "Open in Notes" button is
 * the deliberate way through.
 */
import { Icon } from './Icon'
import { Modal } from './Modal'
import { formatDateTime } from '../lib/format'
import type { Note } from '../lib/ipc'

interface Props {
  note: Note
  onClose: () => void
  onOpenInNotes: () => void
}

export function NotePeek({ note, onClose, onOpenInNotes }: Props) {
  return (
    <Modal
      title={note.title || 'Untitled note'}
      onClose={onClose}
      width={520}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={onOpenInNotes}>
            <Icon name="edit" /> Open in Notes
          </button>
        </>
      }
    >
      <div className="field__row">
        <div className="field">
          <span className="label field__label">Created</span>
          <p className="field__value">{formatDateTime(note.createdAt)}</p>
        </div>
        <div className="field">
          <span className="label field__label">Last modified</span>
          <p className="field__value">{formatDateTime(note.updatedAt)}</p>
        </div>
      </div>

      {note.labels.length > 0 && (
        <div className="field">
          <span className="label field__label">Labels</span>
          <p className="field__value">{note.labels.join(', ')}</p>
        </div>
      )}

      <div className="field">
        <span className="label field__label">Content</span>
        {/* The body is Markdown source; shown as-is rather than rendered,
            which is what the editor shows too. */}
        <div className="field__box notepeek__body">{note.body || 'No content'}</div>
      </div>
    </Modal>
  )
}
