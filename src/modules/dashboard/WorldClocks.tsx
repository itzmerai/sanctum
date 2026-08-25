/**
 * World clocks (U20: R18).
 *
 * Time zones come from the browser's own IANA database via `Intl`, so there is
 * no clock service to call and nothing leaves the machine. The chosen cities
 * persist in localStorage -- they are a preference, not vault data, and must
 * be readable while the vault is locked.
 */
import { useEffect, useState } from 'react'

import { Icon } from '../../components/Icon'

const STORAGE_KEY = 'sanctum.clocks'

/** A small set of zones; the picker offers whatever `Intl` supports. */
const SUGGESTIONS = [
  'Asia/Manila',
  'Australia/Sydney',
  'America/Los_Angeles',
  'America/New_York',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Asia/Dubai',
  'UTC',
]

function cityName(zone: string): string {
  const tail = zone.split('/').pop() ?? zone
  return tail.replace(/_/g, ' ')
}

function readStored(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return ['Australia/Sydney', 'America/Los_Angeles']
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((z): z is string => typeof z === 'string') : []
  } catch {
    // A private window or cleared storage is not an error worth surfacing.
    return []
  }
}

export function WorldClocks() {
  const [zones, setZones] = useState<string[]>(readStored)
  const [now, setNow] = useState(() => Date.now())
  const [adding, setAdding] = useState(false)

  const local = Intl.DateTimeFormat().resolvedOptions().timeZone

  useEffect(() => {
    // One second: the reference shows seconds ticking.
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(zones))
    } catch {
      /* Storage being unavailable must not break the dashboard. */
    }
  }, [zones])

  function render(zone: string) {
    try {
      const time = new Date(now).toLocaleTimeString(undefined, {
        timeZone: zone,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      })
      const date = new Date(now).toLocaleDateString(undefined, {
        timeZone: zone,
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      })
      return { time, date }
    } catch {
      return { time: '--:--:--', date: 'Unknown zone' }
    }
  }

  const all = [local, ...zones.filter((zone) => zone !== local)]

  return (
    <section className="card dash__panel">
      <header className="dash__panelHead">
        <h2 className="dash__panelTitle">
          <Icon name="clock" size={15} /> World Clocks
        </h2>
        <span className="chip chip--live">Live</span>
      </header>

      {all.map((zone) => {
        const { time, date } = render(zone)
        return (
          <div className="clock" key={zone}>
            <span className="clock__city">
              {cityName(zone)}
              {zone === local && <span className="chip clock__local">Local</span>}
            </span>
            <span className="clock__time">
              <span>{time}</span>
              <span className="clock__date">{date}</span>
            </span>
            {zone !== local && (
              <button
                className="iconbtn clock__remove"
                onClick={() => setZones(zones.filter((z) => z !== zone))}
                aria-label={`Remove ${cityName(zone)}`}
              >
                <Icon name="close" size={13} />
              </button>
            )}
          </div>
        )
      })}

      {adding ? (
        <select
          className="input clock__picker"
          defaultValue=""
          onChange={(event) => {
            if (event.target.value) setZones([...zones, event.target.value])
            setAdding(false)
          }}
          aria-label="Add a city"
          autoFocus
        >
          <option value="">Choose a city…</option>
          {SUGGESTIONS.filter((zone) => zone !== local && !zones.includes(zone)).map((zone) => (
            <option key={zone} value={zone}>
              {cityName(zone)}
            </option>
          ))}
        </select>
      ) : (
        <button className="clock__add" onClick={() => setAdding(true)}>
          + Add city or country →
        </button>
      )}
    </section>
  )
}
