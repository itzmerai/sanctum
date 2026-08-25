/**
 * The income area chart (U20: R18).
 *
 * Inline SVG rather than Recharts, which KTD17 named. Recharts is ~450 kB for
 * one static area chart with no interaction; this is one path element built
 * from the same data. The trade is worth revisiting if the dashboard ever
 * needs tooltips, brushing or a second chart type -- until then the dependency
 * costs more than it gives.
 */
import { useEffect, useMemo, useState } from 'react'

import { formatMoney } from '../../lib/format'
import { income, type IncomeEntry } from '../../lib/ipc'

/** How many months of history to plot. */
const MONTHS = 6

export function IncomeChart() {
  const [entries, setEntries] = useState<IncomeEntry[]>([])

  useEffect(() => {
    void income
      .list()
      .then(setEntries)
      .catch(() => setEntries([]))
  }, [])

  const points = useMemo(() => {
    const now = new Date()
    const buckets: { label: string; total: number }[] = []

    for (let back = MONTHS - 1; back >= 0; back--) {
      const month = new Date(now.getFullYear(), now.getMonth() - back, 1)
      const next = new Date(now.getFullYear(), now.getMonth() - back + 1, 1)
      const total = entries
        .filter(
          (entry) => entry.receivedOn >= month.getTime() && entry.receivedOn < next.getTime(),
        )
        .reduce((sum, entry) => sum + entry.amountMinor, 0)

      buckets.push({
        label: month.toLocaleDateString(undefined, { month: 'short' }),
        total,
      })
    }
    return buckets
  }, [entries])

  const max = Math.max(...points.map((p) => p.total), 1)
  const width = 100
  const height = 40

  // A single polyline across the plot, normalised to the viewBox.
  const coords = points.map((point, index) => {
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width
    const y = height - (point.total / max) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const area = `0,${height} ${coords.join(' ')} ${width},${height}`
  const hasData = points.some((point) => point.total !== 0)

  return (
    <div className="chart">
      {hasData ? (
        <svg
          className="chart__svg"
          viewBox={`0 0 ${width} ${height}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Income over the last ${MONTHS} months, peaking at ${formatMoney(max)}`}
        >
          <polygon className="chart__area" points={area} />
          <polyline className="chart__line" points={coords.join(' ')} />
        </svg>
      ) : (
        <p className="dash__none chart__empty">No income logged yet.</p>
      )}

      <div className="chart__axis" aria-hidden="true">
        {points.map((point) => (
          <span key={point.label}>{point.label}</span>
        ))}
      </div>
    </div>
  )
}
