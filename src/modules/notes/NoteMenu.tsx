/**
 * The note overflow menu (U14: R27).
 *
 * Move to folder / Add to favorites are wired in U18, where folders exist as
 * a screen; the two actions that work standalone are here.
 */
import { useEffect, useRef, useState } from 'react'

import { Icon } from '../../components/Icon'

interface Props {
  onDuplicate: () => void
  onDelete: () => void
}

export function NoteMenu({ onDuplicate, onDelete }: Props) {
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
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  return (
    <div className="rowmenu" ref={box}>
      <button
        className="iconbtn"
        onClick={() => setOpen((on) => !on)}
        aria-label="More note actions"
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
              onDuplicate()
            }}
          >
            <Icon name="copy" /> Duplicate
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
            <Icon name="trash" /> {confirming ? 'Click again to delete' : 'Delete note'}
          </button>
        </div>
      )}
    </div>
  )
}
