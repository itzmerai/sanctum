/**
 * One credential in list view (U9: R19).
 *
 * The masked password is a literal string of asterisks, not the real value
 * behind a CSS mask — the row never receives a password at all. Revealing
 * calls `reveal_password` for that one record, and the value is dropped from
 * state the moment the row is re-hidden or unmounted.
 */
import { useEffect, useState } from 'react'

import { Icon } from '../../components/Icon'
import { type Credential, credentials } from '../../lib/ipc'
import { EntityIcon } from './EntityIcon'
import { RowMenu } from './RowMenu'

interface Props {
  item: Credential
  onOpen: () => void
  onCopy: () => void
  onFavorite: () => void
  onEdit: () => void
  onDelete: () => void
}

export function CredentialRow({ item, onOpen, onCopy, onFavorite, onEdit, onDelete }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null)

  // Never leave a revealed password on screen across a navigation.
  useEffect(() => () => setRevealed(null), [])

  async function toggleReveal() {
    if (revealed !== null) {
      setRevealed(null)
      return
    }
    setRevealed(await credentials.revealPassword(item.id))
  }

  return (
    <div className="row">
      <button className="row__main" onClick={onOpen}>
        <EntityIcon name={item.name} website={item.website} />
        <span className="row__text">
          <span className="row__name">{item.name}</span>
          {item.username && <span className="row__sub">{item.username}</span>}
          {item.notes && <span className="row__note">{item.notes}</span>}
        </span>
      </button>

      <span className="row__secret" aria-label={revealed ? 'Password shown' : 'Password hidden'}>
        {revealed ?? '**********'}
      </span>

      <div className="row__actions">
        <button
          className="iconbtn"
          onClick={toggleReveal}
          aria-label={revealed ? 'Hide password' : 'Show password'}
        >
          <Icon name="eye" />
        </button>
        <button className="iconbtn" onClick={onCopy} aria-label="Copy password">
          <Icon name="copy" />
        </button>
        <button
          className="iconbtn"
          data-on={item.favorite}
          onClick={onFavorite}
          aria-label={item.favorite ? 'Remove from favorites' : 'Add to favorites'}
          aria-pressed={item.favorite}
        >
          <Icon name={item.favorite ? 'star-filled' : 'star'} />
        </button>
        <RowMenu onEdit={onEdit} onDelete={onDelete} label={item.name} />
      </div>
    </div>
  )
}
