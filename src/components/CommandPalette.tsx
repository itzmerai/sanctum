/**
 * Global command search (U8/U21: R16).
 *
 * Ctrl+K searches every landed module at once. It reads from already-decrypted
 * data the modules hold, so opening it costs one IPC round per entity type
 * rather than a query per keystroke.
 *
 * Passwords are never among the results. A credential is findable by name,
 * username, website and tags — searching *by* a password would mean holding
 * every password in memory to match against, which is exactly what the rest of
 * the app is built to avoid.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'

import { CommandError, credentials, envFiles, folders, income, notes, tasks } from '../lib/ipc'
import { Icon, type IconName } from './Icon'
import './palette.css'

interface Hit {
  key: string
  icon: IconName
  title: string
  subtitle: string
  route: string
}

/** Static destinations, so the palette also works as a navigator. */
const PAGES: Hit[] = [
  { key: 'page-dashboard', icon: 'dashboard', title: 'Dashboard', subtitle: 'Go to', route: '/dashboard' },
  { key: 'page-vault', icon: 'key', title: 'Vault', subtitle: 'Go to', route: '/vault' },
  { key: 'page-notes', icon: 'note', title: 'Notes', subtitle: 'Go to', route: '/notes' },
  { key: 'page-tasks', icon: 'task', title: 'Tasks', subtitle: 'Go to', route: '/tasks' },
  { key: 'page-calendar', icon: 'calendar', title: 'Calendar', subtitle: 'Go to', route: '/calendar' },
  { key: 'page-income', icon: 'income', title: 'Income', subtitle: 'Go to', route: '/income' },
  { key: 'page-folders', icon: 'folder', title: 'Folders', subtitle: 'Go to', route: '/folders' },
  { key: 'page-favorites', icon: 'star', title: 'Favorites', subtitle: 'Go to', route: '/favorites' },
  { key: 'page-generate', icon: 'wand', title: 'Generate Password', subtitle: 'Go to', route: '/generate' },
  { key: 'page-activity', icon: 'history', title: 'Activity Log', subtitle: 'Go to', route: '/activity' },
  { key: 'page-settings', icon: 'settings', title: 'Settings', subtitle: 'Go to', route: '/settings' },
]

interface Props {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [entries, setEntries] = useState<Hit[]>([])
  const [active, setActive] = useState(0)
  const field = useRef<HTMLInputElement>(null)

  // Load once per opening. Closing discards everything, so decrypted titles do
  // not linger in a component that is not on screen.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setEntries([])
      setActive(0)
      return
    }

    field.current?.focus()
    let cancelled = false

    async function load() {
      try {
        const [creds, noteList, taskList, incomeList, envList, pwFolders, noteFolders] =
          await Promise.all([
            credentials.list(),
            notes.list(),
            tasks.list(),
            income.list(),
            envFiles.list(),
            folders.list('passwords'),
            folders.list('notes'),
          ])
        if (cancelled) return

        const collected: Hit[] = [
          ...creds.map((item) => ({
            key: `credential-${item.id}`,
            icon: 'key' as IconName,
            title: item.name,
            subtitle: [item.username, item.website, ...item.tags.map((t) => `#${t}`)]
              .filter(Boolean)
              .join(' · '),
            route: '/vault',
          })),
          ...noteList.map((item) => ({
            key: `note-${item.id}`,
            icon: 'note' as IconName,
            title: item.title || 'Untitled note',
            subtitle: item.body.trim().split('\n')[0]?.slice(0, 80) ?? 'Note',
            route: '/notes',
          })),
          ...taskList.map((item) => ({
            key: `task-${item.id}`,
            icon: 'task' as IconName,
            title: item.title,
            subtitle: [item.status.replace('_', ' '), item.description].filter(Boolean).join(' · '),
            route: '/tasks',
          })),
          ...incomeList.map((item) => ({
            key: `income-${item.id}`,
            icon: 'income' as IconName,
            title: item.source,
            subtitle: [item.category, item.remarks].filter(Boolean).join(' · '),
            route: '/income',
          })),
          ...envList.map((item) => ({
            key: `env-${item.id}`,
            icon: 'key' as IconName,
            title: item.title,
            subtitle: `${item.environment} env file`,
            route: '/env',
          })),
          ...[...pwFolders, ...noteFolders].map((item) => ({
            key: `folder-${item.id}`,
            icon: 'folder' as IconName,
            title: item.name,
            subtitle: `${item.kind === 'notes' ? 'Notes' : 'Passwords'} folder`,
            route: '/folders',
          })),
        ]
        setEntries(collected)
      } catch (raw) {
        // Locked mid-open is not an error worth reporting; the shell already
        // handles the transition.
        if (!(raw instanceof CommandError && raw.kind === 'locked')) setEntries([])
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [open])

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return PAGES.slice(0, 6)

    const matches = (hit: Hit) =>
      hit.title.toLowerCase().includes(needle) || hit.subtitle.toLowerCase().includes(needle)

    return [...entries.filter(matches), ...PAGES.filter(matches)].slice(0, 20)
  }, [query, entries])

  useEffect(() => {
    setActive(0)
  }, [query])

  const choose = useCallback(
    (hit: Hit | undefined) => {
      if (!hit) return
      navigate(hit.route)
      onClose()
    },
    [navigate, onClose],
  )

  if (!open) return null

  return (
    <div
      className="palette__scrim"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette__field">
          <Icon name="search" />
          <input
            ref={field}
            className="palette__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search credentials, notes, tasks, income…"
            aria-label="Search everything"
            aria-controls="palette-results"
            spellCheck={false}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActive((index) => Math.min(index + 1, results.length - 1))
              } else if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActive((index) => Math.max(index - 1, 0))
              } else if (event.key === 'Enter') {
                event.preventDefault()
                choose(results[active])
              }
            }}
          />
          <kbd>Esc</kbd>
        </div>

        <ul className="palette__results" id="palette-results" role="listbox">
          {results.length === 0 ? (
            <li className="palette__empty">Nothing matches that.</li>
          ) : (
            results.map((hit, index) => (
              <li key={hit.key}>
                <button
                  className="palette__hit"
                  data-active={index === active}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => choose(hit)}
                >
                  <Icon name={hit.icon} />
                  <span className="palette__hitText">
                    <span className="palette__hitTitle">{hit.title}</span>
                    {hit.subtitle && (
                      <span className="palette__hitSub">{hit.subtitle}</span>
                    )}
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  )
}
