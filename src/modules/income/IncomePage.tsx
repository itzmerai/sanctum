/**
 * Income (U17: R32).
 *
 * Amounts are integer minor units end to end. The only division by 100 in the
 * whole path is in `formatMoney`, at render time — see `vault/income.rs` for
 * why a float would drift.
 */
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { formatIsoDate, formatMoney, monthBounds, parseIsoDate, parseMoney } from '../../lib/format'
import { CommandError, income, type IncomeEntry } from '../../lib/ipc'
import './income.css'

const CATEGORIES = ['Salary', 'Freelance', 'Client', 'Dividend', 'Refund', 'Other']
const CURRENCIES = ['PHP', 'USD', 'EUR', 'GBP', 'AUD', 'SGD', 'JPY']

export function IncomePage() {
  const [items, setItems] = useState<IncomeEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [detail, setDetail] = useState<IncomeEntry | null>(null)
  const [editing, setEditing] = useState<IncomeEntry | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setItems(await income.list())
      setError(null)
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const totals = useMemo(() => {
    const { start, end } = monthBounds(Date.now())
    let month = 0
    let all = 0
    for (const entry of items) {
      all += entry.amountMinor
      if (entry.receivedOn >= start && entry.receivedOn < end) month += entry.amountMinor
    }
    return { month, all }
  }, [items])

  // The reference shows one currency in its totals. Mixing currencies in a
  // single sum would be wrong, so the header reports the most common one and
  // each row shows its own.
  const primaryCurrency = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of items) counts.set(entry.currency, (counts.get(entry.currency) ?? 0) + 1)
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 'PHP'
  }, [items])

  const mixed = useMemo(
    () => new Set(items.map((entry) => entry.currency)).size > 1,
    [items],
  )

  async function remove(id: string) {
    await income.remove(id)
    setDetail(null)
    await load()
  }

  return (
    <div data-testid="route-income">
      <header className="page__head">
        <h1 className="page__title">Income</h1>
        <p className="page__sub">Track what comes in and when.</p>
      </header>

      <div className="inc__totals">
        <div className="card inc__total">
          <span className="label">This month</span>
          <p className="inc__amount">{formatMoney(totals.month, primaryCurrency)}</p>
        </div>
        <div className="card inc__total">
          <span className="label">All time</span>
          <p className="inc__amount">{formatMoney(totals.all, primaryCurrency)}</p>
        </div>
        <button className="toolbar__add inc__add" onClick={() => setCreating(true)} aria-label="Log income">
          <Icon name="plus" />
        </button>
      </div>

      {mixed && (
        <p className="form__hint">
          Entries use more than one currency; totals are shown in {primaryCurrency} and are not
          converted.
        </p>
      )}

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="card page__empty">
          <Icon name="income" size={22} />
          <p>No income logged yet.</p>
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <Icon name="plus" /> Log income
          </button>
        </div>
      ) : (
        <div className="card inc__list">
          <div className="inc__row inc__row--header">
            <span className="label">Source</span>
            <span className="label">Category</span>
            <span className="label">Date</span>
            <span className="label inc__right">Amount</span>
          </div>
          {items.map((entry) => (
            <button className="inc__row" key={entry.id} onClick={() => setDetail(entry)}>
              <span className="inc__source">{entry.source}</span>
              <span className="chip">{entry.category}</span>
              <span className="inc__date">{formatIsoDate(entry.receivedOn)}</span>
              <span className="inc__right inc__value" data-negative={entry.amountMinor < 0}>
                {entry.amountMinor >= 0 ? '+ ' : ''}
                {formatMoney(entry.amountMinor, entry.currency)}
              </span>
            </button>
          ))}
        </div>
      )}

      {detail && (
        <Modal
          title={detail.source}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
              <button className="btn btn-danger" onClick={() => void remove(detail.id)}>
                Delete
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setEditing(detail)
                  setDetail(null)
                }}
              >
                Edit
              </button>
            </>
          }
        >
          <div className="field__box inc__detailHead">
            <span>
              <span className="label field__label">Amount</span>
              <span className="inc__detailAmount" data-negative={detail.amountMinor < 0}>
                {detail.amountMinor >= 0 ? '+ ' : ''}
                {formatMoney(detail.amountMinor, detail.currency)}
              </span>
            </span>
            <span className="chip">{detail.category}</span>
          </div>

          <div className="field__row">
            <div className="field">
              <span className="label field__label">Date</span>
              <p className="field__value">{formatIsoDate(detail.receivedOn)}</p>
            </div>
            <div className="field">
              <span className="label field__label">Source</span>
              <p className="field__value">{detail.source}</p>
            </div>
          </div>

          <div className="field">
            <span className="label field__label">Remarks / Notes</span>
            <div className="field__box">{detail.remarks || '—'}</div>
          </div>
        </Modal>
      )}

      {(creating || editing) && (
        <IncomeForm
          existing={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}

function IncomeForm({
  existing,
  onClose,
  onSaved,
}: {
  existing: IncomeEntry | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [source, setSource] = useState(existing?.source ?? '')
  const [amount, setAmount] = useState(
    existing ? (existing.amountMinor / 100).toFixed(2) : '',
  )
  const [currency, setCurrency] = useState(existing?.currency ?? 'PHP')
  const [category, setCategory] = useState(existing?.category ?? 'Salary')
  const [date, setDate] = useState(
    formatIsoDate(existing?.receivedOn ?? Date.now()),
  )
  const [remarks, setRemarks] = useState(existing?.remarks ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountMinor = parseMoney(amount)
  const canSave = source.trim().length > 0 && amountMinor !== null && !busy

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave || amountMinor === null) return

    setBusy(true)
    setError(null)
    try {
      const input = {
        source: source.trim(),
        amountMinor,
        remarks,
        currency,
        category,
        receivedOn: parseIsoDate(date) ?? Date.now(),
      }
      if (existing) await income.update(existing.id, input)
      else await income.create(input)
      await onSaved()
    } catch (raw) {
      setError(raw instanceof CommandError ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={existing ? 'Edit income' : 'Log income'}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="income-form" className="btn btn-primary" disabled={!canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="income-form" onSubmit={save}>
        <div className="field">
          <label className="label field__label" htmlFor="if-source">
            Source
          </label>
          <input
            id="if-source"
            className="input"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="e.g. Salary, client project"
            required
            autoFocus
          />
        </div>

        <div className="field__row">
          <div className="field">
            <label className="label field__label" htmlFor="if-currency">
              Currency
            </label>
            <select
              id="if-currency"
              className="input"
              value={currency}
              onChange={(event) => setCurrency(event.target.value)}
            >
              {CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label field__label" htmlFor="if-amount">
              Amount
            </label>
            <input
              id="if-amount"
              className="input"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              placeholder="0.00"
              inputMode="decimal"
              aria-invalid={amount.length > 0 && amountMinor === null}
              required
            />
          </div>
        </div>

        <div className="field__row">
          <div className="field">
            <label className="label field__label" htmlFor="if-date">
              Date
            </label>
            <input
              id="if-date"
              className="input"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="label field__label" htmlFor="if-category">
              Category
            </label>
            <select
              id="if-category"
              className="input"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              {CATEGORIES.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="if-remarks">
            Remarks / Notes
          </label>
          <textarea
            id="if-remarks"
            className="input"
            value={remarks}
            onChange={(event) => setRemarks(event.target.value)}
            placeholder="Optional context, invoice number, client, or payout note"
          />
        </div>

        {amount.length > 0 && amountMinor === null && (
          <p className="form__hint" data-error="true">
            That is not an amount Sanctum can read. Use digits, like 1250.00.
          </p>
        )}

        {error && (
          <p className="form__hint" data-error="true" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
