/**
 * One credential in grid view (U9: R20).
 *
 * Same data as the list row, arranged as a card with its tags in the corner.
 * Actions stay visible on focus as well as hover, so the card is usable from
 * the keyboard rather than only under a pointer.
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

export function CredentialCard({ item, onOpen, onCopy, onFavorite, onEdit, onDelete }: Props) {
  const [revealed, setRevealed] = useState<string | null>(null)

  useEffect(() => () => setRevealed(null), [])

  async function toggleReveal() {
    if (revealed !== null) {
      setRevealed(null)
      return
    }
    setRevealed(await credentials.revealPassword(item.id))
  }

  return (
    <article className="ccard">
      <header className="ccard__head">
        <EntityIcon name={item.name} website={item.website} />
        {item.tags.length > 0 && (
          <span className="ccard__tags">
            {item.tags.slice(0, 2).map((tag) => (
              <span key={tag}>#{tag}</span>
            ))}
          </span>
        )}
      </header>

      <button className="ccard__main" onClick={onOpen}>
        <span className="row__name">{item.name}</span>
        {item.username && <span className="row__sub">{item.username}</span>}
        {item.notes && <span className="row__note">{item.notes}</span>}
      </button>

      {revealed !== null && <p className="ccard__secret">{revealed}</p>}

      <div className="ccard__actions">
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
    </article>
  )
}
