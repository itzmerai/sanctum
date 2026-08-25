/**
 * When the last backup was taken (U20: R18).
 *
 * A device-local fact about a file the user chose the location of, so it lives
 * in localStorage rather than the vault: a restored backup should not claim a
 * backup was taken on the machine it was restored onto.
 */
const KEY = 'sanctum.lastBackupAt'

export function recordBackup(at = Date.now()): void {
  try {
    localStorage.setItem(KEY, String(at))
  } catch {
    /* Storage being unavailable must not fail an otherwise good backup. */
  }
}

export function lastBackupAt(): number | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const value = Number(raw)
    return Number.isFinite(value) && value > 0 ? value : null
  } catch {
    return null
  }
}
