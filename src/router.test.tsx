import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MODULE_PATHS, RoutesUnderTest } from './router'

describe('U1 scaffold: router', () => {
  it('mounts the unlock tree for the unlock window', () => {
    render(<RoutesUnderTest windowLabel="unlock" />)
    expect(screen.getByTestId('route-unlock')).toBeInTheDocument()
  })

  it('redirects the main window to the dashboard', () => {
    render(<RoutesUnderTest windowLabel="main" />)
    expect(screen.getByTestId('route-dashboard')).toBeInTheDocument()
  })

  it('never serves app routes to the unlock window', () => {
    render(<RoutesUnderTest windowLabel="unlock" initialEntry="/vault" />)
    expect(screen.queryByTestId('route-vault')).not.toBeInTheDocument()
    expect(screen.getByTestId('route-unlock')).toBeInTheDocument()
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
