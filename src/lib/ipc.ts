/**
 * Typed wrappers over the Tauri command surface (U4/U8).
 *
 * Every call the frontend makes to Rust goes through here. Two reasons that
 * matters beyond tidiness:
 *
 * 1. `CommandError` carries a machine-readable `kind`, so the UI branches on a
 *    tag rather than parsing prose. `locked` in particular has to be handled
 *    everywhere, and a single `invoke` wrapper is where that gets normalised.
 * 2. There is deliberately **no** `password` field on `Credential`. The list
 *    and detail views never receive one; revealing and copying are separate
 *    calls. Keeping that shape here means a component cannot accidentally
 *    render a password it was never given.
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core'

// --- errors ------------------------------------------------------------------

export type ErrorKind =
  | 'locked'
  | 'wrongSecret'
  | 'weakPassword'
  | 'notInitialized'
  | 'alreadyInitialized'
  | 'notFound'
  | 'validation'
  | 'unsupportedVault'
  | 'badBackup'
  | 'unsupportedBackup'
  | 'clipboardBusy'
  | 'clipboardUnsupported'
  | 'clipboardFailed'
  | 'io'
  | 'internal'

export class CommandError extends Error {
  readonly kind: ErrorKind
  constructor(kind: ErrorKind, message: string) {
    super(message)
    this.name = 'CommandError'
    this.kind = kind
  }
}

function isRawError(value: unknown): value is { kind: ErrorKind; message: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    'message' in value &&
    typeof (value as { message: unknown }).message === 'string'
  )
}

/** Whether the vault is running outside Tauri (browser preview, tests). */
export function hasBackend(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await tauriInvoke<T>(command, args)
  } catch (raw) {
    if (isRawError(raw)) throw new CommandError(raw.kind, raw.message)
    throw new CommandError('internal', String(raw))
  }
}

// --- types -------------------------------------------------------------------

export interface VaultStatus {
  initialized: boolean
  locked: boolean
  recoveryAcknowledged: boolean
  autoLockMinutes: number
}

export interface StrengthReport {
  score: number
  acceptable: boolean
  reason: string | null
  length: number
}

/** A credential as the UI sees it. Note the absence of `password`. */
export interface Credential {
  id: number
  name: string
  username: string
  website: string
  notes: string
  tags: string[]
  folderId: number | null
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface CredentialInput {
  name: string
  username: string
  password: string
  website: string
  notes: string
  tags: string[]
  folderId: number | null
}

export type ExclusionStatus = 'excluded' | 'notExcluded'

export interface CopyReceipt {
  sequence: number
  exclusion: ExclusionStatus
}

export interface KdfParams {
  m_cost_kib: number
  t_cost: number
  p_cost: number
}

// --- session -----------------------------------------------------------------

export const session = {
  status: () => invoke<VaultStatus>('vault_status'),
  unlock: (password: string) => invoke<void>('unlock_vault', { password }),
  unlockWithRecovery: (code: string) => invoke<void>('unlock_with_recovery', { code }),
  lock: () => invoke<void>('lock_vault'),
  touch: () => invoke<void>('touch_activity'),
  setAutoLockMinutes: (minutes: number) => invoke<void>('set_auto_lock_minutes', { minutes }),
  pollAutoLock: () => invoke<boolean>('poll_auto_lock'),
  /** Returns the new recovery code -- every rotation issues one (R42). */
  changeMasterPassword: (currentPassword: string, newPassword: string) =>
    invoke<string>('change_master_password', { currentPassword, newPassword }),
  rotateRecoveryCode: (masterPassword: string) =>
    invoke<string>('rotate_recovery_code', { masterPassword }),
  resetPasswordWithRecovery: (recoveryCode: string, newPassword: string) =>
    invoke<string>('reset_password_with_recovery', { recoveryCode, newPassword }),
}

// --- setup -------------------------------------------------------------------

export const setup = {
  passwordStrength: (password: string, userInputs: string[] = []) =>
    invoke<StrengthReport>('password_strength', { password, userInputs }),
  createVault: (password: string) =>
    invoke<{ recoveryCode: string }>('setup_vault', { password }),
  acknowledgeRecoveryCode: () => invoke<void>('acknowledge_recovery_code'),
  verifyRecoveryCode: (code: string) => invoke<boolean>('verify_recovery_code', { code }),
  kdfParameters: () => invoke<KdfParams>('kdf_parameters'),
}

// --- credentials -------------------------------------------------------------

export const credentials = {
  list: () => invoke<Credential[]>('list_credentials'),
  get: (id: number) => invoke<Credential | null>('get_credential', { id }),
  /** The only call that returns a password. Use sparingly and never log it. */
  revealPassword: (id: number) => invoke<string>('reveal_password', { id }),
  create: (input: CredentialInput) => invoke<number>('create_credential', { input }),
  update: (id: number, input: CredentialInput) =>
    invoke<void>('update_credential', { id, input }),
  remove: (id: number) => invoke<void>('delete_credential', { id }),
  setFavorite: (entityType: string, id: number, favorite: boolean) =>
    invoke<void>('set_favorite', { entityType, id, favorite }),
  count: () => invoke<number>('credential_count'),
}

// --- clipboard ---------------------------------------------------------------

export const clipboard = {
  /** Copies a stored password without it ever entering JavaScript. */
  copyPassword: (id: number) => invoke<CopyReceipt>('copy_password', { id }),
  copyText: (text: string, autoClear = true) =>
    invoke<CopyReceipt>('copy_text', { text, autoClear }),
  clear: (receipt: CopyReceipt) => invoke<boolean>('clear_clipboard', { receipt }),
  clearSeconds: () => invoke<number>('clipboard_clear_seconds'),
}

// --- data --------------------------------------------------------------------

export const data = {
  exportBackup: (destination: string, backupPassword: string) =>
    invoke<void>('export_backup', { destination, backupPassword }),
  inspectBackup: (source: string, backupPassword: string) =>
    invoke<{ schemaVersion: number; initialized: boolean; sizeBytes: number }>(
      'inspect_backup',
      { source, backupPassword },
    ),
  restoreBackup: (source: string, backupPassword: string) =>
    invoke<void>('restore_backup', { source, backupPassword }),
  exportCsv: (destination: string) => invoke<string>('export_csv', { destination }),
  csvWarning: () => invoke<string>('csv_warning'),
  resetVault: () => invoke<void>('reset_vault'),
}


// --- folders + generator -----------------------------------------------------

export interface Folder {
  id: number
  kind: string
  name: string
  color: string
  itemCount: number
  favorite: boolean
  createdAt: number
}

export const folders = {
  list: (kind: 'passwords' | 'notes') => invoke<Folder[]>('list_folders', { kind }),
  create: (kind: 'passwords' | 'notes', name: string, color: string) =>
    invoke<number>('create_folder', { kind, name, color }),
  update: (id: number, name: string, color: string) =>
    invoke<void>('update_folder', { id, name, color }),
  remove: (id: number) => invoke<void>('delete_folder', { id }),
}

export interface GeneratorOptions {
  length: number
  uppercase: boolean
  lowercase: boolean
  numbers: boolean
  symbols: boolean
}

export const generator = {
  generate: (options: GeneratorOptions) => invoke<string>('generate_password', { options }),
}


// --- notes / tasks / income / activity ---------------------------------------

export interface Note {
  id: number
  title: string
  body: string
  labels: string[]
  folderId: number | null
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface NoteInput {
  title: string
  body: string
  labels: string[]
  folderId: number | null
}

export const notes = {
  list: () => invoke<Note[]>('list_notes'),
  create: (input: NoteInput) => invoke<number>('create_note', { input }),
  update: (id: number, input: NoteInput) => invoke<void>('update_note', { id, input }),
  remove: (id: number) => invoke<void>('delete_note', { id }),
  duplicate: (id: number) => invoke<number>('duplicate_note', { id }),
}

export type TaskStatus = 'todo' | 'in_progress' | 'completed'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: number
  title: string
  description: string
  tags: string[]
  status: TaskStatus
  priority: TaskPriority
  /** Unix seconds, or null. */
  dueDate: number | null
  createdAt: number
  updatedAt: number
}

export interface TaskInput {
  title: string
  description: string
  tags: string[]
  status: TaskStatus
  priority: TaskPriority
  dueDate: number | null
}

export const tasks = {
  list: () => invoke<Task[]>('list_tasks'),
  create: (input: TaskInput) => invoke<number>('create_task', { input }),
  update: (id: number, input: TaskInput) => invoke<void>('update_task', { id, input }),
  setStatus: (id: number, status: TaskStatus) => invoke<void>('set_task_status', { id, status }),
  remove: (id: number) => invoke<void>('delete_task', { id }),
}

export interface IncomeEntry {
  id: number
  source: string
  /** Minor units (cents). Never a float -- see vault/income.rs. */
  amountMinor: number
  remarks: string
  currency: string
  category: string
  receivedOn: number
  createdAt: number
}

export interface IncomeInput {
  source: string
  amountMinor: number
  remarks: string
  currency: string
  category: string
  receivedOn: number
}

export const income = {
  list: () => invoke<IncomeEntry[]>('list_income'),
  create: (input: IncomeInput) => invoke<number>('create_income', { input }),
  update: (id: number, input: IncomeInput) => invoke<void>('update_income', { id, input }),
  remove: (id: number) => invoke<void>('delete_income', { id }),
}

export interface ActivityEntry {
  id: number
  entityType: string
  action: 'created' | 'updated' | 'deleted'
  subject: string
  createdAt: number
}

export const activity = {
  list: () => invoke<ActivityEntry[]>('list_activity'),
  clear: () => invoke<number>('clear_activity'),
}

export interface VaultSummary {
  credentials: number
  notes: number
  openTasks: number
  overdueTasks: number
  incomeThisMonthMinor: number
  incomeAllTimeMinor: number
}

export const dashboard = {
  summary: (monthStart: number, monthEnd: number) =>
    invoke<VaultSummary>('vault_summary', { monthStart, monthEnd }),
}


// --- website icons (U12) -----------------------------------------------------

export const favicon = {
  /** Returns a data: URI, or null. Never throws for a missing icon. */
  fetch: (website: string) => invoke<string | null>('fetch_favicon', { website }),
  setEnabled: (enabled: boolean) => invoke<void>('set_website_icons', { enabled }),
  isEnabled: () => invoke<boolean>('website_icons_enabled'),
}

/** Events the Rust side emits. */
export const events = {
  vaultLocked: 'sanctum://vault-locked',
  vaultUnlocked: 'sanctum://vault-unlocked',
  clipboardCleared: 'sanctum://clipboard-cleared',
} as const
