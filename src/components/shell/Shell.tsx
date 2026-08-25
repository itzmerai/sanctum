/**
 * The application shell (U8: R4, R13, R14, R15, R16, R37).
 *
 * Owns the custom title bar (decorations are off on both windows), the sidebar
 * with its three collapse states, and the routed content area.
 *
 * It also owns the lock transition: when Rust emits `vault-locked`, the shell
 * clears every decrypted value from the store and hands the user back to the
 * unlock window. That is the frontend half of KTD15 — the key being gone in
 * Rust does not help if the WebView is still holding decrypted rows.
 */
import { useEffect, useState } from 'react'
import { NavLink, Outlet } from 'react-router'

import { events, hasBackend, session } from '../../lib/ipc'
import { applyAppearance, useAppearance } from '../../store/useAppearance'
import { useVault } from '../../store/useVault'
import { SanctumMark, Wordmark } from '../Brand'
import { CommandPalette } from '../CommandPalette'
import { Icon, type IconName } from '../Icon'
import { WindowControls } from '../WindowControls'
import './shell.css'

interface NavItem {
  to: string
  label: string
  icon: IconName
}

const MODULES: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' },
  { to: '/vault', label: 'Vault', icon: 'key' },
  { to: '/notes', label: 'Notes', icon: 'note' },
  { to: '/tasks', label: 'Tasks', icon: 'task' },
  { to: '/calendar', label: 'Calendar', icon: 'calendar' },
  { to: '/income', label: 'Income', icon: 'income' },
]

const TOOLS: NavItem[] = [
  { to: '/folders', label: 'Folders', icon: 'folder' },
  { to: '/favorites', label: 'Favorites', icon: 'star' },
  { to: '/generate', label: 'Generate Password', icon: 'wand' },
]

const BOTTOM: NavItem[] = [
  { to: '/activity', label: 'Activity Log', icon: 'history' },
  { to: '/settings', label: 'Settings', icon: 'settings' },
]

export function Shell() {
  const { theme, accent, fontSize, sidebar, displayName, cycleSidebar, toggleTheme } =
    useAppearance()
  const { status, refreshStatus, clearDecrypted, lock } = useVault()
  const [paletteOpen, setPaletteOpen] = useState(false)

  useEffect(() => {
    applyAppearance({ theme, accent, fontSize })
  }, [theme, accent, fontSize])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Auto-lock: Rust owns the timer and tells us when it fires.
  useEffect(() => {
    if (!hasBackend()) return
    let unlisten: (() => void) | undefined
    let unlistenUnlock: (() => void) | undefined

    void import('@tauri-apps/api/event').then(async ({ listen }) => {
      unlistenUnlock = await listen(events.vaultUnlocked, () => {
        void refreshStatus()
      })
      unlisten = await listen(events.vaultLocked, () => {
        // Rust has already dropped the DEK and swapped the windows; this
        // clears the decrypted rows the WebView is still holding (KTD15).
        clearDecrypted()
        void refreshStatus()
      })
    })
    return () => {
      unlisten?.()
      unlistenUnlock?.()
    }
  }, [clearDecrypted, refreshStatus])

  // Rust shows the unlock window and hides this one (commands::windows), so
  // the shell only has to clear what it is holding.
  async function handleLock() {
    await lock()
  }

  // R16: Ctrl+K (Cmd+K on a Mac keyboard) opens global search.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Real interaction restarts the idle window. Deliberately not wired to
  // polling or focus events, which would keep an unattended machine unlocked.
  useEffect(() => {
    if (!hasBackend()) return
    let last = 0
    const touch = () => {
      const now = Date.now()
      // At most one IPC call per 20s: this fires on every keystroke.
      if (now - last < 20_000) return
      last = now
      void session.touch()
    }
    window.addEventListener('keydown', touch)
    window.addEventListener('pointerdown', touch)
    return () => {
      window.removeEventListener('keydown', touch)
      window.removeEventListener('pointerdown', touch)
    }
  }, [])

  const name = displayName || 'You'
  const collapsed = sidebar === 'rail'
  const hidden = sidebar === 'hidden'

  function renderGroup(items: NavItem[], heading?: string) {
    return (
      <div className="nav__group">
        {heading && !collapsed && <p className="label nav__heading">{heading}</p>}
        {items.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav__item${isActive ? ' nav__item--active' : ''}`}
            title={collapsed ? item.label : undefined}
          >
            <Icon name={item.icon} />
            {!collapsed && <span>{item.label}</span>}
          </NavLink>
        ))}
      </div>
    )
  }

  return (
    <div className="shell" data-sidebar={sidebar}>
      <header className="titlebar" data-tauri-drag-region>
        <button
          className="titlebar__hamburger"
          onClick={cycleSidebar}
          aria-label="Toggle sidebar"
        >
          <Icon name="menu" />
        </button>
        <Wordmark size={17} />
        <button className="titlebar__search" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" />
          <span>Search</span>
          <kbd>Ctrl K</kbd>
        </button>
        <div className="titlebar__spacer" />
        <WindowControls />
      </header>

      {!hidden && (
        <aside className="sidebar">
          <div className="sidebar__account">
            <div className="sidebar__avatar" aria-hidden="true">
              <SanctumMark size={16} />
            </div>
            {!collapsed && <span className="sidebar__name">{name}</span>}
            {!collapsed && (
              <button
                className="sidebar__theme"
                onClick={toggleTheme}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
              >
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
              </button>
            )}
          </div>

          <nav className="nav">
            {renderGroup(MODULES, 'Modules')}
            {renderGroup(TOOLS, 'Tools')}
          </nav>

          <div className="sidebar__bottom">
            {renderGroup(BOTTOM)}
            <button className="nav__item nav__item--button" onClick={handleLock}>
              <Icon name="lock" />
              {!collapsed && <span>Lock</span>}
            </button>
          </div>
        </aside>
      )}

      <main className="content">
        {status?.locked ? (
          <div className="content__locked">
            <Icon name="lock" />
            <p>This vault is locked.</p>
          </div>
        ) : (
          <Outlet />
        )}
      </main>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
