/**
 * U5/U6 component gates.
 *
 * The load-bearing ones are `the_list_never_renders_file_contents` and
 * `copying_the_file_sends_the_stored_text`: everything else in this module is
 * convenience, and those two are what keep a production database URI off the
 * screen and make a pasted file identical to the one that was saved.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { EnvFile } from '../../lib/ipc'
import { EnvFilesPage } from './EnvFilesPage'

const listEnvFiles = vi.fn()
const createEnvFile = vi.fn()
const updateEnvFile = vi.fn()
const deleteEnvFile = vi.fn()
const copyText = vi.fn()
const listFolders = vi.fn()

vi.mock('../../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../lib/ipc')>('../../lib/ipc')
  return {
    ...actual,
    hasBackend: () => false,
    envFiles: {
      list: () => listEnvFiles(),
      create: (input: unknown) => createEnvFile(input),
      update: (id: string, input: unknown) => updateEnvFile(id, input),
      remove: (id: string) => deleteEnvFile(id),
    },
    clipboard: { copyText: (text: string) => copyText(text) },
    folders: { list: () => listFolders() },
  }
})

/** A file with the things a naive store would mangle: comment, blank, quotes. */
const RAW = '# Stripe - rotated 2026-03\nSTRIPE_KEY="sk_live_x#not_a_comment"\n\nDATABASE_URL=postgres://u:pw@localhost/acme\n'

function envFile(over: Partial<EnvFile> = {}): EnvFile {
  return {
    // Past 2^53, so a regression to numeric ids would corrupt it.
    id: '5744466908857731456',
    title: 'Acme Storefront',
    content: RAW,
    environment: 'production',
    folderId: null,
    favorite: false,
    createdAt: 1_756_000_000_000,
    updatedAt: 1_756_000_000_000,
    ...over,
  }
}

function renderPage() {
  return render(
    <MemoryRouter>
      <EnvFilesPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  listEnvFiles.mockResolvedValue([envFile()])
  listFolders.mockResolvedValue([])
  copyText.mockResolvedValue({ sequence: 1 })
})

describe('EnvFilesPage', () => {
  it('lists a record with its environment', async () => {
    renderPage()
    expect(await screen.findByText('Acme Storefront')).toBeInTheDocument()
    const list = screen.getByRole('list')
    expect(within(list).getByText('production')).toBeInTheDocument()
  })

  it('never renders file contents in the list', async () => {
    renderPage()
    await screen.findByText('Acme Storefront')

    const list = screen.getByRole('list')
    expect(within(list).queryByText(/sk_live_x/)).toBeNull()
    expect(within(list).queryByText(/postgres:/)).toBeNull()
  })

  it('narrows by title as you search', async () => {
    listEnvFiles.mockResolvedValue([envFile(), envFile({ id: '2', title: 'Globex API' })])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Globex API')

    await user.type(screen.getByLabelText('Search env files'), 'globex')

    expect(screen.queryByText('Acme Storefront')).toBeNull()
    expect(screen.getByText('Globex API')).toBeInTheDocument()
  })

  it('narrows by environment', async () => {
    listEnvFiles.mockResolvedValue([
      envFile(),
      envFile({ id: '2', title: 'Acme Local', environment: 'local' }),
    ])
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Acme Local')

    await user.selectOptions(screen.getByLabelText('Filter by environment'), 'local')

    expect(screen.queryByText('Acme Storefront')).toBeNull()
    expect(screen.getByText('Acme Local')).toBeInTheDocument()
  })

  it('sends the pasted text unmodified', async () => {
    createEnvFile.mockResolvedValue('99')
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Acme Storefront')

    await user.click(screen.getByRole('button', { name: /new env file/i }))
    await user.type(screen.getByLabelText(/project/i), 'Globex API')

    // `type` would interpret braces and newlines; paste is what a user does.
    const area = screen.getByLabelText(/file contents/i)
    await user.click(area)
    await user.paste('# keep me\n\nA=1\n')

    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(createEnvFile).toHaveBeenCalled())
    expect(createEnvFile.mock.calls[0]?.[0]).toMatchObject({
      title: 'Globex API',
      content: '# keep me\n\nA=1\n',
    })
  })

  it('shows a record saved while a filter was active', async () => {
    createEnvFile.mockResolvedValue('99')
    const saved = envFile({ id: '99', title: 'Globex API', environment: 'local' })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Acme Storefront')

    // A stale filter hiding a just-saved record has bitten this app before.
    await user.type(screen.getByLabelText('Search env files'), 'acme')
    await user.click(screen.getByRole('button', { name: /new env file/i }))
    await user.type(screen.getByLabelText(/project/i), 'Globex API')

    listEnvFiles.mockResolvedValue([envFile(), saved])
    await user.click(screen.getByRole('button', { name: 'Save' }))

    expect(await screen.findAllByText('Globex API')).not.toHaveLength(0)
  })

  it('asks before deleting', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Acme Storefront'))
    await user.click(screen.getByRole('button', { name: /delete/i }))

    expect(screen.getByText(/cannot be recovered/i)).toBeInTheDocument()
    expect(deleteEnvFile).not.toHaveBeenCalled()
  })
})

describe('EnvFileDetail', () => {
  async function openDetail() {
    const user = userEvent.setup()
    renderPage()
    await user.click(await screen.findByText('Acme Storefront'))
    return user
  }

  it('masks every value until asked', async () => {
    await openDetail()
    expect(screen.getByText('STRIPE_KEY')).toBeInTheDocument()
    expect(screen.queryByText(/sk_live_x/)).toBeNull()
  })

  it('reveals one value and leaves the others masked', async () => {
    const user = await openDetail()
    await user.click(screen.getByRole('button', { name: 'Show STRIPE_KEY' }))

    expect(screen.getByText('sk_live_x#not_a_comment')).toBeInTheDocument()
    expect(screen.queryByText(/postgres:/)).toBeNull()
  })

  it('copies a single value', async () => {
    const user = await openDetail()
    await user.click(screen.getByRole('button', { name: 'Copy STRIPE_KEY' }))

    expect(copyText).toHaveBeenCalledWith('sk_live_x#not_a_comment')
  })

  it('copies the stored text, not a rebuild of the parsed rows', async () => {
    const user = await openDetail()
    await user.click(screen.getByRole('button', { name: /copy file/i }))

    // Byte-for-byte: comment, blank line and quoting all intact.
    expect(copyText).toHaveBeenCalledWith(RAW)
  })

  it('shows unparseable content raw and still copies it whole', async () => {
    const prose = 'this is not env shaped\nat all'
    listEnvFiles.mockResolvedValue([envFile({ content: prose })])
    const user = await openDetail()

    expect(screen.getByText(/lines were recognised here/i)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /copy file/i }))
    expect(copyText).toHaveBeenCalledWith(prose)
  })

  it('keeps a multi-line value intact when copied', async () => {
    const pem = 'PRIVATE_KEY="-----BEGIN-----\nabc\n-----END-----"\n'
    listEnvFiles.mockResolvedValue([envFile({ content: pem })])
    const user = await openDetail()

    await user.click(screen.getByRole('button', { name: 'Copy PRIVATE_KEY' }))
    expect(copyText).toHaveBeenCalledWith('-----BEGIN-----\nabc\n-----END-----')
  })
})
