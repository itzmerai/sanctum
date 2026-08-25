/**
 * Data settings (U21: R39, R45, AE8, AE10).
 *
 * Backup, CSV export, and Reset Vault.
 *
 * KTD8 drops CSV *import* and the template for v1, so only Export CSV appears
 * here — the reference shows three CSV buttons; two of them would be controls
 * for features that do not exist.
 */
import { useEffect, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { clearBackupRecord, recordBackup } from '../../lib/backupRecord'
import { CommandError, data, hasBackend } from '../../lib/ipc'
import { useAppearance } from '../../store/useAppearance'

type Dialog = 'export' | 'import' | 'reset' | null

export function DataTab() {
  const resetAccountState = useAppearance((state) => state.resetAccountState)
  const [dialog, setDialog] = useState<Dialog>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [csvWarning, setCsvWarning] = useState('')
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [resetTyped, setResetTyped] = useState('')

  useEffect(() => {
    void data
      .csvWarning()
      .then(setCsvWarning)
      .catch(() => undefined)
  }, [])

  /** Opens a native save dialog; returns null if the user cancelled. */
  async function pickSavePath(defaultName: string, extension: string): Promise<string | null> {
    if (!hasBackend()) return null
    const { save } = await import('@tauri-apps/plugin-dialog')
    return save({
      defaultPath: defaultName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    })
  }

  async function pickOpenPath(extension: string): Promise<string | null> {
    if (!hasBackend()) return null
    const { open } = await import('@tauri-apps/plugin-dialog')
    const chosen = await open({
      multiple: false,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    })
    return typeof chosen === 'string' ? chosen : null
  }

  async function exportBackup() {
    setBusy(true)
    setMessage(null)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const destination = await pickSavePath(`sanctum-${stamp}.sanctumbak`, 'sanctumbak')
      if (!destination) return
      await data.exportBackup(destination, password)
      recordBackup()
      setMessage({ kind: 'ok', text: 'Backup written.' })
      setDialog(null)
      setPassword('')
    } catch (raw) {
      setMessage({ kind: 'error', text: raw instanceof Error ? raw.message : String(raw) })
    } finally {
      setBusy(false)
    }
  }

  async function importBackup() {
    setBusy(true)
    setMessage(null)
    try {
      const source = await pickOpenPath('sanctumbak')
      if (!source) return

      // Verify before anything is replaced (AE10). The live vault is untouched
      // if this throws.
      const summary = await data.inspectBackup(source, password)
      const confirmed = window.confirm(
        `This will replace your current vault with the backup (${Math.round(summary.sizeBytes / 1024)} KB).\n\n` +
          'Everything currently in Sanctum on this device will be gone. Continue?',
      )
      if (!confirmed) return

      await data.restoreBackup(source, password)
      setMessage({
        kind: 'ok',
        text: 'Backup restored. Unlock with the master password that vault used.',
      })
      setDialog(null)
      setPassword('')
    } catch (raw) {
      setMessage({
        kind: 'error',
        text:
          raw instanceof CommandError && raw.kind === 'wrongSecret'
            ? 'That password does not open this backup, or the file has been altered. Your vault was not changed.'
            : raw instanceof Error
              ? raw.message
              : String(raw),
      })
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv() {
    setBusy(true)
    setMessage(null)
    try {
      const stamp = new Date().toISOString().slice(0, 10)
      const destination = await pickSavePath(`sanctum-${stamp}.csv`, 'csv')
      if (!destination) return
      const warning = await data.exportCsv(destination)
      setMessage({ kind: 'error', text: warning })
    } catch (raw) {
      setMessage({ kind: 'error', text: raw instanceof Error ? raw.message : String(raw) })
    } finally {
      setBusy(false)
    }
  }

  async function resetVault() {
    setBusy(true)
    try {
      await data.resetVault()
      // Device state described the vault that just ceased to exist. Leaving
      // the backup record in particular would have the Vault Protection panel
      // claim a brand-new vault is backed up.
      clearBackupRecord()
      resetAccountState()
      setDialog(null)
      setResetTyped('')
      // Restarting is the honest way back to first-run setup: every store in
      // the WebView is holding state for a vault that no longer exists.
      if (hasBackend()) {
        const { relaunch } = await import('@tauri-apps/plugin-process')
        await relaunch()
      }
    } catch (raw) {
      setMessage({ kind: 'error', text: raw instanceof Error ? raw.message : String(raw) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <section className="setrow">
        <div className="setrow__text">
          <span className="label">Safe backup</span>
          <h2 className="setrow__title">Encrypted backup</h2>
          <p className="setrow__hint">
            A single protected file for backing up Sanctum or moving your vault to another
            device. It is encrypted with its own password, separate from your master password.
          </p>
        </div>
        <div className="setrow__control setrow__stack">
          <button className="btn" onClick={() => setDialog('export')}>
            <Icon name="copy" /> Export Backup
          </button>
          <button className="btn" onClick={() => setDialog('import')}>
            <Icon name="history" /> Import Backup
          </button>
        </div>
      </section>

      <section className="setrow">
        <div className="setrow__text">
          <span className="label">Plain text tools</span>
          <h2 className="setrow__title">CSV file</h2>
          <p className="setrow__hint">{csvWarning || 'Exports every password in plain text.'}</p>
        </div>
        <div className="setrow__control setrow__stack">
          <button className="btn" onClick={exportCsv} disabled={busy}>
            <Icon name="note" /> Export CSV
          </button>
        </div>
      </section>

      <section className="setrow setrow--danger">
        <div className="setrow__text">
          <span className="label">Danger zone</span>
          <h2 className="setrow__title">Reset vault</h2>
          <p className="setrow__hint">
            Permanently delete local Sanctum data on this device and return to setup. This
            cannot be undone, and a recovery code will not bring it back.
          </p>
        </div>
        <div className="setrow__control">
          <button className="btn btn-danger" onClick={() => setDialog('reset')}>
            <Icon name="trash" /> Reset Vault
          </button>
        </div>
      </section>

      {message && (
        <p className="form__hint" data-error={message.kind === 'error'} role="alert">
          {message.text}
        </p>
      )}

      {(dialog === 'export' || dialog === 'import') && (
        <Modal
          title={dialog === 'export' ? 'Export encrypted backup' : 'Import backup'}
          onClose={() => {
            setDialog(null)
            setPassword('')
          }}
          width={400}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setDialog(null)
                  setPassword('')
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={password.length === 0 || busy}
                onClick={dialog === 'export' ? exportBackup : importBackup}
              >
                {busy ? 'Working…' : dialog === 'export' ? 'Choose location' : 'Choose file'}
              </button>
            </>
          }
        >
          <p className="setrow__hint">
            {dialog === 'export'
              ? 'Choose a password for this backup file. You will need it to restore, and it is not stored anywhere.'
              : 'Enter the password this backup was created with. Your current vault is not touched unless the file opens successfully.'}
          </p>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Backup password"
            autoComplete="off"
            aria-label="Backup password"
            autoFocus
          />
        </Modal>
      )}

      {dialog === 'reset' && (
        <Modal
          title="Reset this vault?"
          onClose={() => {
            setDialog(null)
            setResetTyped('')
          }}
          width={400}
          footer={
            <>
              <button
                className="btn"
                onClick={() => {
                  setDialog(null)
                  setResetTyped('')
                }}
              >
                Cancel
              </button>
              <button
                className="btn btn-danger"
                disabled={resetTyped !== 'RESET' || busy}
                onClick={resetVault}
              >
                {busy ? 'Resetting…' : 'Delete everything'}
              </button>
            </>
          }
        >
          <p className="setrow__hint">
            Every credential, note, task and income entry on this device will be deleted, along
            with your display name and profile picture. Your recovery code will not bring them
            back — it opens a vault, and there will not be one. If you have an encrypted backup,
            this is the moment to check you can still open it.
          </p>
          <label className="label field__label" htmlFor="reset-ack">
            Type RESET to confirm
          </label>
          <input
            id="reset-ack"
            className="input"
            value={resetTyped}
            onChange={(event) => setResetTyped(event.target.value)}
            placeholder="RESET"
            autoFocus
          />
        </Modal>
      )}
    </>
  )
}
