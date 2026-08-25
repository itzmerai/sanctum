/**
 * Line icons, drawn inline (U8).
 *
 * Hand-rolled rather than an icon package: this needs about twenty glyphs, and
 * a dependency would add a few hundred kilobytes plus a supply-chain surface
 * to an app whose entire premise is that it does not phone home or carry
 * things it does not need. They inherit `currentColor` and a 1.5px stroke to
 * match the reference's weight.
 */

export type IconName =
  | 'menu'
  | 'search'
  | 'dashboard'
  | 'key'
  | 'note'
  | 'task'
  | 'calendar'
  | 'income'
  | 'folder'
  | 'star'
  | 'star-filled'
  | 'wand'
  | 'history'
  | 'settings'
  | 'lock'
  | 'moon'
  | 'sun'
  | 'eye'
  | 'copy'
  | 'more'
  | 'plus'
  | 'grid'
  | 'list'
  | 'chevron-down'
  | 'shield'
  | 'clock'
  | 'trash'
  | 'edit'
  | 'close'

const PATHS: Record<IconName, string> = {
  menu: 'M3 6h18M3 12h18M3 18h18',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  dashboard: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  key: 'M15.5 8.5a3.5 3.5 0 1 1-4.6 3.32L4 19v2h3l1-1v-2h2v-2h2l1.68-1.68A3.5 3.5 0 0 1 15.5 8.5Z',
  note: 'M6 3h8l4 4v14H6zM14 3v4h4',
  task: 'M9 11l2 2 4-4M5 4h14v16H5z',
  calendar: 'M4 6h16v14H4zM4 10h16M8 3v4M16 3v4',
  income: 'M3 17l6-6 4 4 7-7M14 8h6v6',
  folder: 'M3 6h6l2 2h10v11H3z',
  star: 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.5l-5.4 2.9 1-6.1L3.2 10l6.1-.9z',
  'star-filled': 'M12 3.5l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.5l-5.4 2.9 1-6.1L3.2 10l6.1-.9z',
  wand: 'M4 20l10-10M14 4l1.5 3L19 8.5 15.5 10 14 13l-1.5-3L9 8.5 12.5 7z',
  history: 'M3 12a9 9 0 1 0 3-6.7M3 4v4h4M12 7v5l3 2',
  settings:
    'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4.6a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z',
  lock: 'M6 11h12v10H6zM9 11V7a3 3 0 0 1 6 0v4',
  moon: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z',
  sun: 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10ZM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7ZM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  more: 'M12 6.5h.01M12 12h.01M12 17.5h.01',
  plus: 'M12 5v14M5 12h14',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  list: 'M4 6h16M4 12h16M4 18h16',
  'chevron-down': 'M6 9l6 6 6-6',
  shield: 'M12 3l8 3v6c0 5-3.4 8.3-8 9-4.6-.7-8-4-8-9V6z',
  clock: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2',
  trash: 'M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13',
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 5l4 4',
  close: 'M6 6l12 12M18 6L6 18',
}

interface Props {
  name: IconName
  size?: number
  filled?: boolean
  className?: string
}

export function Icon({ name, size = 16, filled = false, className }: Props) {
  const isFilled = filled || name === 'star-filled'
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d={PATHS[name]} />
    </svg>
  )
}
