/**
 * The dashboard (U20: R17, R18, AE7).
 *
 * The counts come from `vault_summary`, a single command that answers the
 * whole panel — the alternative is five list calls that decrypt every record
 * in the vault to display six numbers.
 */
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router'

import { Icon } from '../../components/Icon'
import { lastBackupAt } from '../../lib/backupRecord'
import { formatDay, formatMoney, formatRelative, isOverdue, monthBounds } from '../../lib/format'
import {
  CommandError,
  clipboard,
  credentials,
  dashboard,
  session,
  tasks,
  type Credential,
  type Task,
  type VaultSummary,
} from '../../lib/ipc'
import { useAppearance } from '../../store/useAppearance'
import { IncomeChart } from './IncomeChart'
import { WorldClocks } from './WorldClocks'
import './dashboard.css'

function greeting(hour: number): string {
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardPage() {
  const { displayName } = useAppearance()
  const [summary, setSummary] = useState<VaultSummary | null>(null)
  const [upcoming, setUpcoming] = useState<Task[]>([])
  const [recent, setRecent] = useState<Credential[]>([])
  const [autoLockMinutes, setAutoLockMinutes] = useState<number | null>(null)
  const [recoveryReady, setRecoveryReady] = useState(false)
  const [backupAt, setBackupAt] = useState<number | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function load() {
      try {
        const { start, end } = monthBounds(Date.now())
        const [totals, taskList, credentialList, status] = await Promise.all([
          dashboard.summary(start, end),
          tasks.list(),
          credentials.list(),
          session.status(),
        ])

        setSummary(totals)
        setUpcoming(
          taskList
            .filter((task) => task.status !== 'completed' && task.dueDate !== null)
            .slice(0, 3),
        )
        setRecent(credentialList.slice(0, 3))
        setAutoLockMinutes(status.autoLockMinutes)
        setRecoveryReady(status.recoveryAcknowledged)
        setBackupAt(lastBackupAt())
        setError(null)
      } catch (raw) {
        if (!(raw instanceof CommandError && raw.kind === 'locked')) {
          setError(raw instanceof Error ? raw.message : String(raw))
        }
      }
    }
    void load()
  }, [])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const checks = useMemo(() => {
    const list = [
      {
        label: 'Backup',
        ready: backupAt !== null,
        detail:
          backupAt === null
            ? 'No backup taken yet'
            : `Backed up ${formatRelative(backupAt)}`,
      },
      {
        label: 'Auto-lock',
        ready: autoLockMinutes !== null,
        detail: autoLockMinutes === null ? 'Unknown' : `Locks after ${autoLockMinutes} mins`,
      },
      {
        label: 'Recovery',
        ready: recoveryReady,
        detail: recoveryReady ? 'Code is ready' : 'Code not acknowledged',
      },
    ]
    return list
  }, [autoLockMinutes, recoveryReady, backupAt])

  const readyCount = checks.filter((check) => check.ready).length

  async function copyPassword(id: string) {
    try {
      const receipt = await clipboard.copyPassword(id)
      setToast(
        receipt.exclusion === 'excluded'
          ? 'Password copied. Clears in 30 seconds.'
          : 'Password copied, but Windows may keep its own copy.',
      )
    } catch {
      setToast('Could not copy the password.')
    }
  }

  const name = displayName || 'there'

  return (
    <div className="dash" data-testid="route-dashboard">
      <div className="dash__main">
        <header className="page__head">
          <h1 className="page__title dash__greeting">
            {greeting(new Date().getHours())}, {name}.
          </h1>
          <p className="page__sub">Here's everything across your Life OS.</p>
        </header>

        {error && <p className="vault__error">{error}</p>}

        <div className="dash__stats">
          <Link to="/vault" className="card dash__stat">
            <span className="dash__statLabel">
              <Icon name="key" size={14} /> Credentials
            </span>
            <span className="dash__statValue">{summary?.credentials ?? '—'}</span>
          </Link>
          <Link to="/notes" className="card dash__stat">
            <span className="dash__statLabel">
              <Icon name="note" size={14} /> Notes
            </span>
            <span className="dash__statValue">{summary?.notes ?? '—'}</span>
          </Link>
          <Link to="/tasks" className="card dash__stat">
            <span className="dash__statLabel">
              <Icon name="task" size={14} /> Tasks
            </span>
            <span className="dash__statValue">{summary?.openTasks ?? '—'}</span>
          </Link>
        </div>

        {/* AE7: the overdue callout, and it links straight to the tasks. */}
        {summary !== null && summary.overdueTasks > 0 && (
          <Link to="/tasks" className="dash__overdue">
            <span className="dash__overdueDot" aria-hidden="true" />
            <span>
              {summary.overdueTasks} task{summary.overdueTasks === 1 ? '' : 's'} overdue
            </span>
            <span className="dash__overdueLink">View tasks →</span>
          </Link>
        )}

        <section className="card dash__panel">
          <header className="dash__panelHead">
            <h2 className="dash__panelTitle">
              <Icon name="income" size={15} /> Income Activity
            </h2>
            <span className="chip chip--live">Active</span>
          </header>

          <div className="dash__incomeTotals">
            <div className="dash__incomeBox">
              <span className="label">This month</span>
              <p className="dash__incomeValue">
                {formatMoney(summary?.incomeThisMonthMinor ?? 0)}
              </p>
            </div>
            <div className="dash__incomeBox">
              <span className="label">All time</span>
              <p className="dash__incomeValue">
                {formatMoney(summary?.incomeAllTimeMinor ?? 0)}
              </p>
            </div>
          </div>

          <IncomeChart />
        </section>

        <section className="card dash__panel">
          <header className="dash__panelHead">
            <h2 className="dash__panelTitle">Recent Credentials</h2>
            <Link to="/vault" className="dash__viewAll">
              View all
            </Link>
          </header>

          {recent.length === 0 ? (
            <p className="dash__none">Nothing saved yet.</p>
          ) : (
            recent.map((item) => (
              <div className="dash__recent" key={item.id}>
                <span className="dash__recentText">
                  <span className="row__name">{item.name}</span>
                  <span className="row__sub">{item.username}</span>
                </span>
                <button
                  className="iconbtn"
                  onClick={() => void copyPassword(item.id)}
                  aria-label={`Copy password for ${item.name}`}
                >
                  <Icon name="copy" />
                </button>
              </div>
            ))
          )}
        </section>
      </div>

      <aside className="dash__side">
        <WorldClocks />

        <section className="card dash__panel">
          <header className="dash__panelHead">
            <h2 className="dash__panelTitle">
              <Icon name="calendar" size={15} /> Upcoming Tasks
            </h2>
            <Link to="/tasks" className="dash__viewAll">
              View all
            </Link>
          </header>

          {upcoming.length === 0 ? (
            <p className="dash__none">Nothing due.</p>
          ) : (
            upcoming.map((task) => (
              <div className="dash__task" key={task.id}>
                <span className={`dash__taskDot dash__taskDot--${task.priority}`} aria-hidden="true" />
                <span className="dash__taskTitle">{task.title}</span>
                <span className="dash__taskDue" data-overdue={isOverdue(task.dueDate)}>
                  {task.dueDate === null ? '' : formatDay(task.dueDate)}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="card dash__panel">
          <header className="dash__panelHead">
            <h2 className="dash__panelTitle">
              <Icon name="shield" size={15} /> Vault Protection
            </h2>
            <span className="chip" data-ready={readyCount === checks.length}>
              {readyCount === checks.length ? 'Ready' : 'Action needed'}
            </span>
          </header>

          <p className="dash__ratio">
            {readyCount}/{checks.length}
            <span className="dash__ratioLabel">checks ready</span>
          </p>
          <div className="dash__meter" aria-hidden="true">
            <span style={{ width: `${(readyCount / checks.length) * 100}%` }} />
          </div>

          {checks.map((check) => (
            <div className="dash__check" key={check.label}>
              <span className="dash__checkDot" data-ready={check.ready} aria-hidden="true" />
              <span className="dash__checkLabel">{check.label}</span>
              <span className="dash__checkDetail">{check.detail}</span>
            </div>
          ))}

          <Link to="/settings" className="btn btn-primary dash__backup">
            Create Backup
          </Link>
        </section>
      </aside>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  )
}
