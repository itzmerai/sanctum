/**
 * Display formatting (U14–U20).
 *
 * Timestamps from Rust are Unix **milliseconds** (migration M3), so they go
 * straight into `Date` with no conversion.
 */

/** e.g. "Aug 11, 09:27 PM" — the reference's note-list format. */
export function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** e.g. "Aug 18" — compact enough for a task row. */
export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** e.g. "2026-07-20" — for detail views and `<input type="date">`. */
export function formatIsoDate(ms: number): string {
  const date = new Date(ms)
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/** Parses `<input type="date">` as local midnight, not UTC midnight. */
export function parseIsoDate(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  // `new Date("2026-08-18")` parses as UTC and can land on the previous day
  // west of Greenwich. Constructing from parts keeps it local.
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])).getTime()
}

/**
 * Relative time, as the activity log shows it.
 *
 * Deliberately coarse: "2m ago" is what the reference displays, and a log of
 * personal actions gains nothing from second-level precision.
 */
export function formatRelative(ms: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - ms) / 1000))
  if (seconds < 45) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  return formatDay(ms)
}

/**
 * Formats minor units as currency.
 *
 * Amounts are integers throughout (see `vault/income.rs`); the division by 100
 * happens here, at the last possible moment, purely for display.
 */
export function formatMoney(amountMinor: number, currency = 'PHP'): string {
  const major = amountMinor / 100
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      currencyDisplay: 'code',
      minimumFractionDigits: 2,
    }).format(major)
  } catch {
    // An unknown currency code throws rather than degrading, and a ledger
    // that renders nothing is worse than one that renders plainly.
    return `${currency} ${major.toFixed(2)}`
  }
}

/** Parses a typed amount into minor units, rounding half away from zero. */
export function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[\s,]/g, '')
  if (!/^-?\d*\.?\d*$/.test(cleaned) || cleaned === '' || cleaned === '-') return null
  const value = Number(cleaned)
  if (!Number.isFinite(value)) return null
  // `Math.round(-0.5)` is -0, not -1, so round the magnitude and reapply sign.
  const sign = value < 0 ? -1 : 1
  return sign * Math.round(Math.abs(value) * 100)
}

/** Start and end of the local month containing `ms`, as a half-open range. */
export function monthBounds(ms: number): { start: number; end: number } {
  const date = new Date(ms)
  const start = new Date(date.getFullYear(), date.getMonth(), 1).getTime()
  const end = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime()
  return { start, end }
}

/** Whether a due date has passed (AE7). */
export function isOverdue(dueDate: number | null, now = Date.now()): boolean {
  return dueDate !== null && dueDate < now
}
