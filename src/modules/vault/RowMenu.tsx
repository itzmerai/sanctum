/**
 * The overflow menu on a credential row or card (U9).
 *
 * Delete asks for confirmation inline rather than opening a second dialog --
 * a nested modal over a list is heavier than the decision warrants, and the
 * two-step click still prevents an accidental destroy.
 */
import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../components/Icon'

interface Props {
  onEdit: () => void
  onDelete: () => void
  label: string
}

export function RowMenu({ onEdit, onDelete, label }: Props) {
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function away(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) {
        setOpen(false)
        setConfirming(false)
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setConfirming(false)
      }
    }
    document.addEventListener('mousedown', away)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', away)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return (
    <div className="rowmenu" ref={box}>
      <button
        className="iconbtn"
        onClick={() => setOpen((on) => !on)}
        aria-label={`More actions for ${label}`}
        aria-expanded={open}
      >
        <Icon name="more" />
      </button>

      {open && (
        <div className="rowmenu__panel" role="menu">
          <button
            className="rowmenu__item"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              onEdit()
            }}
          >
            <Icon name="edit" /> Edit
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
              setConfirming(false)
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
