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

/**
 * Row ids are **strings**, not numbers.
 *
 * They are random 63-bit integers (so a deleted row cannot have its id
 * reused and its ciphertext replayed). A JSON number is a float64 in
 * JavaScript, exact only to 2^53 - 1, so an id sent as a number silently
 * loses its low bits and then matches no row. See src-tauri/commands/ids.rs.
 */
export type Id = string

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
  id: Id
  name: string
  username: string
  website: string
  notes: string
  tags: string[]
  folderId: Id | null
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
  folderId: Id | null
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
  get: (id: Id) => invoke<Credential | null>('get_credential', { id }),
  /** The only call that returns a password. Use sparingly and never log it. */
  revealPassword: (id: Id) => invoke<string>('reveal_password', { id }),
  create: (input: CredentialInput) => invoke<Id>('create_credential', { input }),
  update: (id: Id, input: CredentialInput) =>
    invoke<void>('update_credential', { id, input }),
  remove: (id: Id) => invoke<void>('delete_credential', { id }),
  setFavorite: (entityType: string, id: Id, favorite: boolean) =>
    invoke<void>('set_favorite', { entityType, id, favorite }),
  count: () => invoke<number>('credential_count'),
}

// --- clipboard ---------------------------------------------------------------

export const clipboard = {
  /** Copies a stored password without it ever entering JavaScript. */
  copyPassword: (id: Id) => invoke<CopyReceipt>('copy_password', { id }),
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
  id: Id
  kind: string
  name: string
  color: string
  itemCount: number
  favorite: boolean
  createdAt: number
}

/** Folders are scoped per module, so a project needs one folder per kind. */
export type FolderKind = 'passwords' | 'notes' | 'env'

export const folders = {
  list: (kind: FolderKind) => invoke<Folder[]>('list_folders', { kind }),
  create: (kind: FolderKind, name: string, color: string) =>
    invoke<Id>('create_folder', { kind, name, color }),
  update: (id: Id, name: string, color: string) =>
    invoke<void>('update_folder', { id, name, color }),
  remove: (id: Id) => invoke<void>('delete_folder', { id }),
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
  id: Id
  title: string
  body: string
  labels: string[]
  folderId: Id | null
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface NoteInput {
  title: string
  body: string
  labels: string[]
  folderId: Id | null
}

export const notes = {
  list: () => invoke<Note[]>('list_notes'),
  create: (input: NoteInput) => invoke<Id>('create_note', { input }),
  update: (id: Id, input: NoteInput) => invoke<void>('update_note', { id, input }),
  remove: (id: Id) => invoke<void>('delete_note', { id }),
  duplicate: (id: Id) => invoke<Id>('duplicate_note', { id }),
}

export type TaskStatus = 'todo' | 'in_progress' | 'completed'
export type TaskPriority = 'low' | 'medium' | 'high'

export interface Task {
  id: Id
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
  create: (input: TaskInput) => invoke<Id>('create_task', { input }),
  update: (id: Id, input: TaskInput) => invoke<void>('update_task', { id, input }),
  setStatus: (id: Id, status: TaskStatus) => invoke<void>('set_task_status', { id, status }),
  remove: (id: Id) => invoke<void>('delete_task', { id }),
}

export interface IncomeEntry {
  id: Id
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
  create: (input: IncomeInput) => invoke<Id>('create_income', { input }),
  update: (id: Id, input: IncomeInput) => invoke<void>('update_income', { id, input }),
  remove: (id: Id) => invoke<void>('delete_income', { id }),
}

export interface ActivityEntry {
  id: Id
  entityType: string
  action: 'created' | 'updated' | 'deleted'
  subject: string
  createdAt: number
}

export const activity = {
  list: () => invoke<ActivityEntry[]>('list_activity'),
  clear: () => invoke<number>('clear_activity'),
}

// --- env files (U3) ----------------------------------------------------------

/** The three environments an env file can belong to (R2). */
export type EnvEnvironment = 'production' | 'staging' | 'local'

export const ENV_ENVIRONMENTS: EnvEnvironment[] = ['production', 'staging', 'local']

export interface EnvFile {
  id: Id
  /** The project this file belongs to. */
  title: string
  /** The raw file text, byte-for-byte as saved. Never reformatted. */
  content: string
  environment: EnvEnvironment
  folderId: Id | null
  favorite: boolean
  createdAt: number
  updatedAt: number
}

export interface EnvFileInput {
  title: string
  content: string
  environment: EnvEnvironment
  folderId: Id | null
}

export const envFiles = {
  list: () => invoke<EnvFile[]>('list_env_files'),
  create: (input: EnvFileInput) => invoke<Id>('create_env_file', { input }),
  update: (id: Id, input: EnvFileInput) => invoke<void>('update_env_file', { id, input }),
  remove: (id: Id) => invoke<void>('delete_env_file', { id }),
}

/** Reads a picked .env from disk. Rust does the reading; see read_env_text. */
export function readEnvText(source: string) {
  return invoke<string>('read_env_text', { source })
}

export interface VaultSummary {
  credentials: number
  notes: number
  envFiles: number
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
