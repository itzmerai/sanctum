/**
 * The credential detail modal (U9: R21).
 *
 * The password starts hidden even here. Opening a detail view is not the same
 * as asking to see the secret — it is frequently done to check a username or
 * a note, often with someone else at the desk.
 */
import { useEffect, useState } from 'react'

import { Modal } from '../../components/Modal'
import { Icon } from '../../components/Icon'
import { type Credential, credentials } from '../../lib/ipc'
import { EntityIcon } from './EntityIcon'

interface Props {
  item: Credential
  onClose: () => void
  onCopy: () => void
  onEdit: () => void
}

export function CredentialDetail({ item, onClose, onCopy, onEdit }: Props) {
  const [password, setPassword] = useState<string | null>(null)

  useEffect(() => () => setPassword(null), [])

  async function toggle() {
    setPassword(password === null ? await credentials.revealPassword(item.id) : null)
  }

  return (
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn" onClick={onCopy}>
            Copy password
          </button>
          <button className="btn btn-primary" onClick={onEdit}>
            Edit
          </button>
        </>
      }
    >
      {item.username && (
        <div className="detail__identity">
          <EntityIcon name={item.name} website={item.website} size={32} />
          <span>{item.username}</span>
        </div>
      )}

      <div className="field__row">
        <div className="field">
          <span className="label field__label">Username / Email</span>
          <p className="field__value">{item.username || '—'}</p>
        </div>
        <div className="field">
          <span className="label field__label">Website</span>
          <p className="field__value">{item.website || '—'}</p>
        </div>
      </div>

      <div className="field__row">
        <div className="field">
          <span className="label field__label">Password</span>
          <p className="field__value detail__password">
            <span>{password ?? '••••••••••'}</span>
            <button
              className="iconbtn"
              onClick={toggle}
              aria-label={password ? 'Hide password' : 'Show password'}
            >
              <Icon name="eye" />
            </button>
          </p>
        </div>
        <div className="field">
          <span className="label field__label">Tags</span>
          <p className="field__value">
            {item.tags.length > 0 ? item.tags.map((tag) => `#${tag}`).join(', ') : '—'}
          </p>
        </div>
      </div>

      {item.notes && (
        <div className="field">
          <span className="label field__label">Notes</span>
          <div className="field__box">{item.notes}</div>
        </div>
      )}
    </Modal>
  )
}
