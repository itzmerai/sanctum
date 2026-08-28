/**
 * U18 folder-kind gates.
 *
 * Folders are scoped per kind, so each module needs its own tab and its own
 * create path. Without the third tab there was no way to make an env folder at
 * all, which left the Env Files folder picker permanently empty.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FoldersPage } from './FoldersPage'

const listFolders = vi.fn()
const createFolder = vi.fn()
const listCredentials = vi.fn()
const listEnvFiles = vi.fn()

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc')
  return {
    ...actual,
    hasBackend: () => false,
    folders: {
      list: (kind: string) => listFolders(kind),
      create: (kind: string, name: string, color: string) => createFolder(kind, name, color),
      update: vi.fn(),
      remove: vi.fn(),
    },
    credentials: { list: () => listCredentials() },
    envFiles: { list: () => listEnvFiles() },
    notes: { list: () => Promise.resolve([]) },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  listFolders.mockResolvedValue([])
  listCredentials.mockResolvedValue([])
  listEnvFiles.mockResolvedValue([])
  createFolder.mockResolvedValue('1')
})

function renderPage() {
  return render(
    <MemoryRouter>
      <FoldersPage />
    </MemoryRouter>,
  )
}

describe('FoldersPage', () => {
  it('offers a tab for every folder kind', async () => {
    renderPage()
    await waitFor(() => expect(listFolders).toHaveBeenCalled())

    for (const label of ['Passwords', 'Notes', 'Env Files']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    }
  })

  it('loads env folders when that tab is chosen', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(listFolders).toHaveBeenCalledWith('passwords'))

    await user.click(screen.getByRole('button', { name: 'Env Files' }))

    await waitFor(() => expect(listFolders).toHaveBeenCalledWith('env'))
  })

  it('creates the folder under the selected kind', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(listFolders).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Env Files' }))
    // Two of these exist: the toolbar `+` and the empty-state button.
    const [newFolder] = screen.getAllByRole('button', { name: /new folder/i })
    await user.click(newFolder!)
    await user.type(screen.getByLabelText(/name/i), 'Acme Storefront')
    await user.click(screen.getByRole('button', { name: /^save$/i }))

    await waitFor(() => expect(createFolder).toHaveBeenCalled())
    // The kind must follow the tab -- an env folder filed as a password folder
    // would never appear in the Env Files picker.
    expect(createFolder.mock.calls[0]?.[0]).toBe('env')
    expect(createFolder.mock.calls[0]?.[1]).toBe('Acme Storefront')
  })

  it('names the empty state after the selected kind', async () => {
    const user = userEvent.setup()
    renderPage()
    await waitFor(() => expect(listFolders).toHaveBeenCalled())

    await user.click(screen.getByRole('button', { name: 'Env Files' }))

    expect(await screen.findByText(/no env file folders yet/i)).toBeInTheDocument()
  })
})
