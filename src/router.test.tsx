import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'

import { MODULE_PATHS, RoutesUnderTest } from './router'
import { useAppearance } from './store/useAppearance'

/** Reset persisted appearance between tests. */
beforeEach(() => {
  localStorage.clear()
  useAppearance.setState({
    theme: 'light',
    accent: 'slate',
    fontSize: 'medium',
    sidebar: 'expanded',
    displayName: '',
    websiteIcons: false,
  })
})

describe('window routing (U1/U4)', () => {
  it('mounts the lock screen for the unlock window', () => {
    render(<RoutesUnderTest windowLabel="unlock" />)
    expect(screen.getByText('Coded for privacy.')).toBeInTheDocument()
    expect(screen.getByLabelText('Master password')).toBeInTheDocument()
  })

  it('never serves app routes to the unlock window', () => {
    render(<RoutesUnderTest windowLabel="unlock" initialEntry="/vault" />)
    expect(screen.queryByTestId('route-vault')).not.toBeInTheDocument()
    expect(screen.getByText('Coded for privacy.')).toBeInTheDocument()
  })

  it('redirects the main window to the dashboard', () => {
    render(<RoutesUnderTest windowLabel="main" />)
    expect(screen.getByTestId('route-dashboard')).toBeInTheDocument()
  })

  it('resolves every sidebar module to its own route (R13)', () => {
    expect(MODULE_PATHS).toHaveLength(11)
    for (const path of MODULE_PATHS) {
      const { unmount } = render(<RoutesUnderTest windowLabel="main" initialEntry={`/${path}`} />)
      expect(screen.getByTestId(`route-${path}`)).toBeInTheDocument()
      unmount()
    }
  })
})

describe('the lock screen (U4)', () => {
  it('carries the R3 brand strings', () => {
    render(<RoutesUnderTest windowLabel="unlock" />)
    expect(screen.getByText('Coded for privacy.')).toBeInTheDocument()
    expect(screen.getByText(/root@sanctum:~\/vault\//)).toBeInTheDocument()
    expect(screen.getByText(/AES-256/)).toBeInTheDocument()
    expect(screen.getByText(/\[ SYSTEM_STATUS: LOCKED \]/)).toBeInTheDocument()
  })

  it('masks the password and can reveal it', async () => {
    const user = userEvent.setup()
    render(<RoutesUnderTest windowLabel="unlock" />)

    const field = screen.getByLabelText('Master password')
    expect(field).toHaveAttribute('type', 'password')

    await user.click(screen.getByLabelText('Show password'))
    expect(field).toHaveAttribute('type', 'text')
  })

  it('cannot submit an empty password', () => {
    render(<RoutesUnderTest windowLabel="unlock" />)
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled()
  })

  it('offers the recovery path', async () => {
    const user = userEvent.setup()
    render(<RoutesUnderTest windowLabel="unlock" />)

    await user.click(screen.getByText(/Forgot password\? Use recovery code/))
    expect(screen.getByLabelText('Recovery code')).toBeInTheDocument()
  })
})

describe('the app shell (U8)', () => {
  it('renders every navigation group (R13)', () => {
    render(<RoutesUnderTest windowLabel="main" />)
    const nav = screen.getByRole('navigation')

    for (const label of ['Dashboard', 'Vault', 'Notes', 'Tasks', 'Calendar', 'Income']) {
      expect(within(nav).getByText(label)).toBeInTheDocument()
    }
    for (const label of ['Folders', 'Favorites', 'Generate Password']) {
      expect(within(nav).getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('Modules')).toBeInTheDocument()
    expect(screen.getByText('Tools')).toBeInTheDocument()
  })

  it('marks the current route as active', () => {
    render(<RoutesUnderTest windowLabel="main" initialEntry="/vault" />)
    const link = screen.getByRole('link', { name: 'Vault' })
    expect(link.className).toContain('nav__item--active')
  })

  /** R14: expanded -> rail -> hidden -> expanded. */
  it('cycles the sidebar through its three states', async () => {
    const user = userEvent.setup()
    const { container } = render(<RoutesUnderTest windowLabel="main" />)
    const shell = container.querySelector('.shell')!
    const toggle = screen.getByLabelText('Toggle sidebar')

    expect(shell).toHaveAttribute('data-sidebar', 'expanded')
    await user.click(toggle)
    expect(shell).toHaveAttribute('data-sidebar', 'rail')
    await user.click(toggle)
    expect(shell).toHaveAttribute('data-sidebar', 'hidden')
    await user.click(toggle)
    expect(shell).toHaveAttribute('data-sidebar', 'expanded')
  })

  it('hides nav labels in the rail state but keeps the links', async () => {
    const user = userEvent.setup()
    render(<RoutesUnderTest windowLabel="main" />)

    await user.click(screen.getByLabelText('Toggle sidebar'))
    expect(screen.queryByText('Modules')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Vault' })).toBeInTheDocument()
  })

  it('toggles the theme and applies it to the document (R37)', async () => {
    const user = userEvent.setup()
    render(<RoutesUnderTest windowLabel="main" />)

    expect(document.documentElement.dataset.theme).toBe('light')
    await user.click(screen.getByLabelText('Switch to dark theme'))
    expect(useAppearance.getState().theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('applies accent and font size to the document (R37)', () => {
    useAppearance.setState({ accent: 'clay', fontSize: 'large' })
    render(<RoutesUnderTest windowLabel="main" />)

    expect(document.documentElement.dataset.accent).toBe('clay')
    expect(document.documentElement.dataset.size).toBe('large')
  })

  it('shows the search affordance with its shortcut (R16)', () => {
    render(<RoutesUnderTest windowLabel="main" />)
    expect(screen.getByText('Search')).toBeInTheDocument()
    expect(screen.getByText('Ctrl K')).toBeInTheDocument()
  })

  it('offers a lock control (R9)', () => {
    render(<RoutesUnderTest windowLabel="main" />)
    expect(screen.getByRole('button', { name: 'Lock' })).toBeInTheDocument()
  })
})
