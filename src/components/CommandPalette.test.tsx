/**
 * Command palette gates (U8/U21: R16).
 *
 * The load-bearing one is `never_offers_a_password`: search reaches across
 * every module, and a search index that held passwords would undo the
 * list-payload guarantee the vault screen is built around.
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CommandPalette } from './CommandPalette'

const listCredentials = vi.fn()
const listNotes = vi.fn()
const listTasks = vi.fn()
const listIncome = vi.fn()
const listEnvFiles = vi.fn()
const listFolders = vi.fn()

vi.mock('../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../lib/ipc')>('../lib/ipc')
  return {
    ...actual,
    credentials: { list: () => listCredentials() },
    notes: { list: () => listNotes() },
    tasks: { list: () => listTasks() },
    income: { list: () => listIncome() },
    envFiles: { list: () => listEnvFiles() },
    folders: { list: (kind: string) => listFolders(kind) },
  }
})

beforeEach(() => {
  vi.clearAllMocks()
  listEnvFiles.mockResolvedValue([])
  listCredentials.mockResolvedValue([
    {
      id: 1,
      name: 'Stripe Developer Dashboard',
      username: 'billing@codeforge.io',
      website: 'stripe.com',
      notes: '',
      tags: ['payments'],
      folderId: null,
      favorite: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ])
  listNotes.mockResolvedValue([
    {
      id: 2,
      title: 'API Rate Limiting',
      body: 'Token bucket in Redis',
      labels: [],
      folderId: null,
      favorite: false,
      createdAt: 0,
      updatedAt: 0,
    },
  ])
  listTasks.mockResolvedValue([
    {
      id: 3,
      title: 'Renew certificate',
      description: 'Before it expires',
      tags: [],
      status: 'todo',
      priority: 'high',
      dueDate: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ])
  listIncome.mockResolvedValue([
    {
      id: 4,
      source: 'Client G Audit',
      amountMinor: 100,
      remarks: '',
      currency: 'PHP',
      category: 'Salary',
      receivedOn: 0,
      createdAt: 0,
    },
  ])
  // Folder kinds are disjoint in the schema, so the mock must honour the
  // argument rather than returning the same list twice.
  listFolders.mockImplementation((kind: string) =>
    Promise.resolve(
      kind === 'passwords'
        ? [{ id: 5, kind: 'passwords', name: 'Client Projects', color: '#e8734a', itemCount: 1, favorite: false, createdAt: 0 }]
        : [{ id: 6, kind: 'notes', name: 'Architecture Guides', color: '#4a7fc1', itemCount: 2, favorite: false, createdAt: 0 }],
    ),
  )
})

function open() {
  return render(
    <MemoryRouter>
      <CommandPalette open onClose={() => {}} />
    </MemoryRouter>,
  )
}

describe('command palette (R16)', () => {
  it('renders nothing while closed', () => {
    const { container } = render(
      <MemoryRouter>
        <CommandPalette open={false} onClose={() => {}} />
      </MemoryRouter>,
    )
    expect(container).toBeEmptyDOMElement()
    expect(listCredentials).not.toHaveBeenCalled()
  })

  /** R16: results must span every landed module, not just the vault. */
  it('searches across every module', async () => {
    const user = userEvent.setup()
    open()
    const field = await screen.findByLabelText('Search everything')

    await user.type(field, 'stripe')
    expect(await screen.findByText('Stripe Developer Dashboard')).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'rate limiting')
    expect(await screen.findByText('API Rate Limiting')).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'renew')
    expect(await screen.findByText('Renew certificate')).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'client g')
    expect(await screen.findByText('Client G Audit')).toBeInTheDocument()

    await user.clear(field)
    await user.type(field, 'client projects')
    expect(await screen.findByText('Client Projects')).toBeInTheDocument()
  })

  it('matches on username, website and tags as well as name', async () => {
    const user = userEvent.setup()
    open()
    const field = await screen.findByLabelText('Search everything')

    for (const term of ['billing@codeforge', 'stripe.com', 'payments']) {
      await user.clear(field)
      await user.type(field, term)
      expect(
        await screen.findByText('Stripe Developer Dashboard'),
        `searching ${term}`,
      ).toBeInTheDocument()
    }
  })

  /**
   * The vault list deliberately never receives a password. A search index that
   * did would reintroduce exactly what that avoids.
   */
  it('never offers a password', async () => {
    const user = userEvent.setup()
    const { container } = open()
    const field = await screen.findByLabelText('Search everything')

    await user.type(field, 'stripe')
    await screen.findByText('Stripe Developer Dashboard')

    // Nothing the palette loaded carries a password field at all.
    for (const call of listCredentials.mock.results) {
      for (const row of await call.value) {
        expect(row).not.toHaveProperty('password')
      }
    }
    expect(container.textContent).not.toMatch(/password/i)
  })

  it('finds an env file by project but never by its contents', async () => {
    listEnvFiles.mockResolvedValue([
      {
        id: '5744466908857731456',
        title: 'Acme Storefront',
        content: 'DATABASE_URL=postgres://u:hunter2@localhost/acme',
        environment: 'production',
        folderId: null,
        favorite: false,
        createdAt: 1,
        updatedAt: 1,
      },
    ])
    const user = userEvent.setup()
    const { container } = open()
    const field = await screen.findByLabelText('Search everything')

    await user.type(field, 'acme')
    expect(await screen.findByText('Acme Storefront')).toBeInTheDocument()

    // The file is findable by project name; its secrets are not in the DOM,
    // and searching by a value must not surface it either.
    expect(container.textContent).not.toMatch(/hunter2|postgres:/)

    await user.clear(field)
    await user.type(field, 'hunter2')
    expect(screen.queryByText('Acme Storefront')).toBeNull()
  })

  it('offers pages so it doubles as a navigator', async () => {
    open()
    // With an empty query it shows destinations rather than nothing.
    expect(await screen.findByText('Dashboard')).toBeInTheDocument()
    expect(screen.getByText('Vault')).toBeInTheDocument()
  })

  it('reports when nothing matches', async () => {
    const user = userEvent.setup()
    open()
    await user.type(await screen.findByLabelText('Search everything'), 'zzzznothing')
    expect(await screen.findByText('Nothing matches that.')).toBeInTheDocument()
  })

  it('moves the selection with the arrow keys', async () => {
    const user = userEvent.setup()
    open()
    const field = await screen.findByLabelText('Search everything')
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(1))

    const first = screen.getAllByRole('option')[0]!
    expect(first).toHaveAttribute('aria-selected', 'true')

    await user.type(field, '{ArrowDown}')
    expect(screen.getAllByRole('option')[1]!).toHaveAttribute('aria-selected', 'true')

    await user.type(field, '{ArrowUp}')
    expect(screen.getAllByRole('option')[0]!).toHaveAttribute('aria-selected', 'true')
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <MemoryRouter>
        <CommandPalette open onClose={onClose} />
      </MemoryRouter>,
    )

    await user.type(await screen.findByLabelText('Search everything'), '{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
