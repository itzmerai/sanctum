/**
 * U9/U10 component gates.
 *
 * The IPC layer is mocked at the module boundary, which is the seam between
 * "what the frontend does" and "what Rust does". Rust's side is covered by 152
 * tests of its own; these assert the UI contract on top of it — including that
 * a password never arrives in a list payload.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Credential } from '../../lib/ipc'
import { VaultPage } from './VaultPage'

const listCredentials = vi.fn()
const revealPassword = vi.fn()
const createCredential = vi.fn()
const updateCredential = vi.fn()
const deleteCredential = vi.fn()
const setFavorite = vi.fn()
const copyPassword = vi.fn()
const passwordStrength = vi.fn()
const generatePassword = vi.fn()
const listFolders = vi.fn()

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc')
  return {
    ...actual,
    hasBackend: () => false,
    credentials: {
      list: () => listCredentials(),
      revealPassword: (id: number) => revealPassword(id),
      create: (input: unknown) => createCredential(input),
      update: (id: number, input: unknown) => updateCredential(id, input),
      remove: (id: number) => deleteCredential(id),
      setFavorite: (t: string, id: number, on: boolean) => setFavorite(t, id, on),
      count: () => Promise.resolve(0),
      get: () => Promise.resolve(null),
    },
    clipboard: { copyPassword: (id: number) => copyPassword(id) },
    setup: { passwordStrength: (p: string) => passwordStrength(p) },
    generator: { generate: (o: unknown) => generatePassword(o) },
    folders: { list: () => listFolders() },
  }
})

function credential(over: Partial<Credential> = {}): Credential {
  return {
    id: 1,
    name: 'Vercel Deployment Team',
    username: 'deployer@vercel.com',
    website: 'https://vercel.com',
    notes: 'Production Next.js deployment platform.',
    tags: ['vercel', 'nextjs'],
    folderId: null,
    favorite: false,
    createdAt: 1_700_000_000,
    updatedAt: 1_700_000_000,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <VaultPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listCredentials.mockResolvedValue([
    credential(),
    credential({ id: 2, name: 'Stripe Developer Dashboard', username: 'billing@codeforge.io', tags: ['stripe', 'payments'], favorite: true }),
    credential({ id: 3, name: 'AWS Production Console', username: 'dev-admin@codeforge.io', tags: ['cloud'] }),
  ])
  revealPassword.mockResolvedValue('Vc_live_88xP9vL3mK0')
  passwordStrength.mockResolvedValue({ score: 4, acceptable: true, reason: null, length: 20 })
  generatePassword.mockResolvedValue('G3n#rated-P4ssw0rd!x')
  listFolders.mockResolvedValue([{ id: 10, kind: 'passwords', name: 'Client Projects', color: '#e8734a', itemCount: 1, favorite: false, createdAt: 0 }])
  copyPassword.mockResolvedValue({ sequence: 1, exclusion: 'excluded' })
})

describe('vault list and grid (U9: R19, R20)', () => {
  it('lists every credential with its username', async () => {
    renderPage()
    expect(await screen.findByText('Vercel Deployment Team')).toBeInTheDocument()
    expect(screen.getByText('Stripe Developer Dashboard')).toBeInTheDocument()
    expect(screen.getByText('deployer@vercel.com')).toBeInTheDocument()
    expect(screen.getByText(/You have 3 credentials/)).toBeInTheDocument()
  })

  /** The load payload must not contain a password at all. */
  it('never receives a password when listing', async () => {
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    for (const call of listCredentials.mock.results) {
      const rows = await call.value
      for (const row of rows) {
        expect(row).not.toHaveProperty('password')
      }
    }
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('masks passwords until revealed, then fetches only that one', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    expect(screen.getAllByText('**********')).toHaveLength(3)

    await user.click(screen.getAllByLabelText('Show password')[0]!)
    expect(await screen.findByText('Vc_live_88xP9vL3mK0')).toBeInTheDocument()
    expect(revealPassword).toHaveBeenCalledTimes(1)
    expect(revealPassword).toHaveBeenCalledWith(1)
  })

  it('hides a revealed password again', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText('Show password')[0]!)
    await screen.findByText('Vc_live_88xP9vL3mK0')
    await user.click(screen.getAllByLabelText('Hide password')[0]!)
    expect(screen.queryByText('Vc_live_88xP9vL3mK0')).not.toBeInTheDocument()
  })

  it('switches between list and grid', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await screen.findByText('Vercel Deployment Team')

    expect(container.querySelector('.vault__list')).toBeTruthy()
    await user.click(screen.getByLabelText('Grid view'))
    expect(container.querySelector('.vault__grid')).toBeTruthy()
    expect(screen.getByText('Vercel Deployment Team')).toBeInTheDocument()
  })

  it('narrows the list by search', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.type(screen.getByLabelText('Search vault'), 'stripe')
    expect(screen.getByText('Stripe Developer Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('Vercel Deployment Team')).not.toBeInTheDocument()
  })

  it('searches usernames and notes as well as names', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    const box = screen.getByLabelText('Search vault')
    await user.type(box, 'dev-admin')
    expect(screen.getByText('AWS Production Console')).toBeInTheDocument()
    expect(screen.queryByText('Stripe Developer Dashboard')).not.toBeInTheDocument()
  })

  it('narrows the list by tag', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.selectOptions(screen.getByLabelText('Filter by tag'), 'payments')
    expect(screen.getByText('Stripe Developer Dashboard')).toBeInTheDocument()
    expect(screen.queryByText('AWS Production Console')).not.toBeInTheDocument()
  })

  it('shows an empty state when nothing matches', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.type(screen.getByLabelText('Search vault'), 'zzzznothing')
    expect(screen.getByText('Nothing matches that search.')).toBeInTheDocument()
  })

  it('offers to create the first credential when the vault is empty', async () => {
    listCredentials.mockResolvedValue([])
    renderPage()
    expect(await screen.findByText(/No credentials yet/)).toBeInTheDocument()
  })

  it('copies through the clipboard command, not through JavaScript', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText('Copy password')[0]!)
    expect(copyPassword).toHaveBeenCalledWith(1)
    expect(await screen.findByText(/Clears in 30 seconds/)).toBeInTheDocument()
  })

  /** R43: when Windows exclusion did not apply, the user must be told. */
  it('discloses when the clipboard could not be excluded', async () => {
    copyPassword.mockResolvedValue({ sequence: 1, exclusion: 'notExcluded' })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText('Copy password')[0]!)
    expect(await screen.findByText(/Windows may keep its own copy/)).toBeInTheDocument()
  })

  it('toggles a favorite', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText('Add to favorites')[0]!)
    expect(setFavorite).toHaveBeenCalledWith('credential', 1, true)
  })

  it('requires two clicks to delete', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText(/More actions for/)[0]!)
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }))
    expect(deleteCredential).not.toHaveBeenCalled()

    await user.click(screen.getByRole('menuitem', { name: /Click again to delete/ }))
    expect(deleteCredential).toHaveBeenCalledWith(1)
  })
})

describe('credential detail (U9: R21)', () => {
  it('opens with the password hidden', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Vercel Deployment Team'))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('••••••••••')).toBeInTheDocument()
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('shows the credential fields', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Vercel Deployment Team'))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('https://vercel.com')).toBeInTheDocument()
    expect(within(dialog).getByText('#vercel, #nextjs')).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Copy password' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Edit' })).toBeInTheDocument()
  })

  it('closes on Escape', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Vercel Deployment Team'))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})

describe('credential form (U10: R22, R23, AE6)', () => {
  async function openForm() {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')
    await user.click(screen.getByLabelText('New credential'))
    return user
  }

  it('requires a name', async () => {
    await openForm()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('saves a new credential', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'GitHub')
    await user.type(screen.getByLabelText('Username / Email'), 'dev@example.com')
    await user.type(screen.getByLabelText('Password'), 's3cret-value')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createCredential).toHaveBeenCalled())
    expect(createCredential.mock.calls[0]![0]).toMatchObject({
      name: 'GitHub',
      username: 'dev@example.com',
      password: 's3cret-value',
    })
  })

  /** AE6: a sixth tag is rejected. */
  it('rejects a sixth tag', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Too many')
    await user.type(screen.getByLabelText('Tags'), 'a, b, c, d, e, f')

    expect(screen.getByRole('alert')).toHaveTextContent(/at most 5/)
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
  })

  it('accepts exactly five tags', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Five')
    await user.type(screen.getByLabelText('Tags'), 'a, b, c, d, e')

    expect(screen.getByText('5 of 5 tags used.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled()
  })

  it('strips a leading hash from tags', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Name'), 'Tagged')
    await user.type(screen.getByLabelText('Tags'), '#dev, #ops')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createCredential).toHaveBeenCalled())
    expect(createCredential.mock.calls[0]![0].tags).toEqual(['dev', 'ops'])
  })

  it('shows a strength meter as the password is typed (R23)', async () => {
    const user = await openForm()
    await user.type(screen.getByLabelText('Password'), 'a-strong-passphrase')
    expect(await screen.findByText('Excellent')).toBeInTheDocument()
  })

  it('fills the field from the generator', async () => {
    const user = await openForm()
    await user.click(screen.getByLabelText('Generate a password'))

    await waitFor(() =>
      expect(screen.getByLabelText('Password')).toHaveValue('G3n#rated-P4ssw0rd!x'),
    )
    expect(generatePassword).toHaveBeenCalled()
  })

  it('offers the folders that exist', async () => {
    await openForm()
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'Client Projects' })).toBeInTheDocument(),
    )
  })

  /** Editing must not put the stored password into the DOM unasked. */
  it('does not prefill the password when editing', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText(/More actions for/)[0]!)
    await user.click(screen.getByRole('menuitem', { name: /Edit/ }))

    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(screen.getByLabelText('Password')).toHaveAttribute('placeholder', 'Unchanged')
    expect(revealPassword).not.toHaveBeenCalled()
  })

  it('keeps the stored password when the field is left untouched', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Vercel Deployment Team')

    await user.click(screen.getAllByLabelText(/More actions for/)[0]!)
    await user.click(screen.getByRole('menuitem', { name: /Edit/ }))
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Renamed')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(updateCredential).toHaveBeenCalled())
    expect(revealPassword).toHaveBeenCalledWith(1)
    expect(updateCredential.mock.calls[0]![1]).toMatchObject({
      name: 'Renamed',
      password: 'Vc_live_88xP9vL3mK0',
    })
  })
})
