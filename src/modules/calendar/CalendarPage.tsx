/**
 * Calendar (U16: R30, R31).
 *
 * Week / Month / Year over tasks and income, with the summary rail from the
 * reference.
 *
 * The month grid is built here rather than with `react-day-picker` (KTD17).
 * The library solves date *picking* — selection state, ranges, keyboard entry
 * — none of which this screen does. What it needs is a 6x7 grid with arbitrary
 * content per cell, which is about twenty lines of `Date` arithmetic and no
 * dependency. `react-day-picker` is still the right choice for the date inputs
 * in the task and income forms, where picking is the whole job.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { formatDay, formatMoney, isOverdue } from '../../lib/format'
import { CommandError, income, tasks, type IncomeEntry, type Task } from '../../lib/ipc'
import { TaskForm } from '../tasks/TaskForm'
import './calendar.css'

type View = 'week' | 'month' | 'year'

/** Local midnight for a date, so day comparisons ignore the time. */
function startOfDay(value: Date): number {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
}

function sameDay(a: number, b: number): boolean {
  return startOfDay(new Date(a)) === startOfDay(new Date(b))
}

/** The 42 days a month grid shows, starting on Monday. */
function monthGrid(anchor: Date): Date[] {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  // getDay() is 0=Sunday; shift so Monday is the first column.
  const offset = (first.getDay() + 6) % 7
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset)
  return Array.from({ length: 42 }, (_, index) => {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  })
}

function weekGrid(anchor: Date): Date[] {
  const offset = (anchor.getDay() + 6) % 7
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - offset)
  return Array.from({ length: 7 }, (_, index) => {
    return new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
  })
}

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function CalendarPage() {
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState(() => new Date())
  const [taskList, setTaskList] = useState<Task[]>([])
  const [incomeList, setIncomeList] = useState<IncomeEntry[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Creating from a day cell pre-fills that date, which is the whole point of
  // adding a task from a calendar rather than from the task list.
  const [creatingOn, setCreatingOn] = useState<number | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)

  const load = useCallback(async () => {
    try {
      const [t, i] = await Promise.all([tasks.list(), income.list()])
      setTaskList(t)
      setIncomeList(i)
      setError(null)
    } catch (raw) {
      if (!(raw instanceof CommandError && raw.kind === 'locked')) {
        setError(raw instanceof Error ? raw.message : String(raw))
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return taskList
    return taskList.filter((task) => task.title.toLowerCase().includes(needle))
  }, [taskList, query])

  function tasksOn(day: Date): Task[] {
    return filtered.filter(
      (task) => task.dueDate !== null && sameDay(task.dueDate, day.getTime()),
    )
  }

  function incomeOn(day: Date): number {
    return incomeList
      .filter((entry) => sameDay(entry.receivedOn, day.getTime()))
      .reduce((sum, entry) => sum + entry.amountMinor, 0)
  }

  /** Counts for the rail, scoped to the visible period. */
  const period = useMemo(() => {
    const inRange = (ms: number) => {
      const date = new Date(ms)
      if (view === 'year') return date.getFullYear() === anchor.getFullYear()
      if (view === 'month') {
        return (
          date.getFullYear() === anchor.getFullYear() && date.getMonth() === anchor.getMonth()
        )
      }
      const days = weekGrid(anchor).map((d) => startOfDay(d))
      return days.includes(startOfDay(date))
    }

    const scoped = filtered.filter((task) => task.dueDate !== null && inRange(task.dueDate))
    return {
      open: scoped.filter((task) => task.status !== 'completed').length,
      completed: scoped.filter((task) => task.status === 'completed').length,
      overdue: scoped.filter(
        (task) => task.status !== 'completed' && isOverdue(task.dueDate),
      ).length,
      income: incomeList
        .filter((entry) => inRange(entry.receivedOn))
        .reduce((sum, entry) => sum + entry.amountMinor, 0),
      upcoming: filtered
        .filter((task) => task.status !== 'completed' && task.dueDate !== null)
        .slice(0, 3),
    }
  }, [filtered, incomeList, view, anchor])

  function shift(direction: -1 | 1) {
    if (view === 'year') {
      setAnchor(new Date(anchor.getFullYear() + direction, anchor.getMonth(), 1))
    } else if (view === 'month') {
      setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + direction, 1))
    } else {
      setAnchor(
        new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() + direction * 7),
      )
    }
  }

  const heading =
    view === 'year'
      ? `${anchor.getFullYear()}`
      : anchor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

  return (
    <div className="cal" data-testid="route-calendar">
      <div className="cal__main">
        <header className="page__head cal__head">
          <div>
            <h1 className="page__title">Calendar</h1>
            <p className="page__sub">Tasks and income across your schedule.</p>
          </div>

          <div className="cal__controls">
            <div className="toolbar__search cal__search">
              <Icon name="search" />
              <input
                className="toolbar__input"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search"
                aria-label="Search calendar"
              />
            </div>

            <div className="segmented cal__views" role="group" aria-label="Calendar view">
              {(['week', 'month', 'year'] as View[]).map((item) => (
                <button
                  key={item}
                  className="cal__view"
                  data-on={view === item}
                  onClick={() => setView(item)}
                  aria-pressed={view === item}
                >
                  {item[0]!.toUpperCase() + item.slice(1)}
                </button>
              ))}
            </div>

            <div className="cal__nav">
              <button className="iconbtn" onClick={() => shift(-1)} aria-label="Previous">
                ‹
              </button>
              <button className="btn cal__today" onClick={() => setAnchor(new Date())}>
                Today
              </button>
              <button className="iconbtn" onClick={() => shift(1)} aria-label="Next">
                ›
              </button>
              <button
                className="toolbar__add"
                onClick={() => setCreatingOn(Date.now())}
                aria-label="New task"
              >
                <Icon name="plus" />
              </button>
            </div>
          </div>
        </header>

        {error && <p className="vault__error">{error}</p>}

        <div className="card cal__panel">
          <header className="cal__periodHead">
            <h2 className="cal__period">{heading}</h2>
            <span className="cal__periodMeta">
              {period.open} open · {period.completed} completed
            </span>
          </header>

          {view === 'year' ? (
            <div className="cal__year">
              {Array.from({ length: 12 }, (_, month) => {
                const monthDate = new Date(anchor.getFullYear(), month, 1)
                const open = filtered.filter(
                  (task) =>
                    task.status !== 'completed' &&
                    task.dueDate !== null &&
                    new Date(task.dueDate).getFullYear() === anchor.getFullYear() &&
                    new Date(task.dueDate).getMonth() === month,
                ).length
                const total = incomeList
                  .filter(
                    (entry) =>
                      new Date(entry.receivedOn).getFullYear() === anchor.getFullYear() &&
                      new Date(entry.receivedOn).getMonth() === month,
                  )
                  .reduce((sum, entry) => sum + entry.amountMinor, 0)

                return (
                  <button
                    key={month}
                    className="cal__monthCard"
                    data-current={month === new Date().getMonth() && anchor.getFullYear() === new Date().getFullYear()}
                    onClick={() => {
                      setAnchor(monthDate)
                      setView('month')
                    }}
                  >
                    <span className="cal__monthName">
                      {monthDate.toLocaleDateString(undefined, { month: 'long' })}
                    </span>
                    <span className="cal__monthMeta">{open} open tasks</span>
                    <span className="cal__monthMeta">{formatMoney(total)}</span>
                  </button>
                )
              })}
            </div>
          ) : (
            <>
              <div className="cal__weekdays" aria-hidden="true">
                {WEEKDAYS.map((day) => (
                  <span key={day}>{day}</span>
                ))}
              </div>
              <div className={view === 'week' ? 'cal__week' : 'cal__grid'}>
                {(view === 'week' ? weekGrid(anchor) : monthGrid(anchor)).map((day) => {
                  const dayTasks = tasksOn(day)
                  const dayIncome = incomeOn(day)
                  const outside = view === 'month' && day.getMonth() !== anchor.getMonth()

                  return (
                    <div
                      className="cal__day"
                      key={day.toISOString()}
                      data-outside={outside}
                      data-today={sameDay(day.getTime(), Date.now())}
                    >
                      <button
                        className="cal__dayNum cal__dayAdd"
                        onClick={() => setCreatingOn(day.getTime())}
                        aria-label={`Add a task due ${day.toDateString()}`}
                      >
                        {day.getDate()}
                      </button>
                      {dayTasks.slice(0, 3).map((task) => (
                        <button
                          className={`cal__chip cal__chip--${task.priority}`}
                          key={task.id}
                          data-done={task.status === 'completed'}
                          title={task.title}
                          onClick={() => setEditing(task)}
                        >
                          {task.title}
                        </button>
                      ))}
                      {dayTasks.length > 3 && (
                        <span className="cal__more">+{dayTasks.length - 3} more</span>
                      )}
                      {dayIncome !== 0 && (
                        <span className="cal__income">{formatMoney(dayIncome)}</span>
                      )}
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>

      <aside className="cal__rail">
        <section className="card dash__panel">
          <h2 className="dash__panelTitle">
            <Icon name="calendar" size={15} />
            {view === 'year' ? 'This year' : view === 'month' ? 'This month' : 'This week'}
          </h2>
          <div className="cal__stat">
            <span>Open tasks</span>
            <strong>{period.open}</strong>
          </div>
          <div className="cal__stat">
            <span>Completed</span>
            <strong>{period.completed}</strong>
          </div>
          <div className="cal__stat">
            <span>Income</span>
            <strong>{formatMoney(period.income)}</strong>
          </div>
        </section>

        <section className="card dash__panel">
          <h2 className="dash__panelTitle">
            <Icon name="clock" size={15} /> Upcoming tasks
          </h2>
          {period.upcoming.length === 0 ? (
            <p className="dash__none">Nothing due.</p>
          ) : (
            period.upcoming.map((task) => (
              <div className="dash__task" key={task.id}>
                <span
                  className={`dash__taskDot dash__taskDot--${task.priority}`}
                  aria-hidden="true"
                />
                <span className="dash__taskTitle">{task.title}</span>
                <span className="dash__taskDue">
                  {task.dueDate === null ? '' : formatDay(task.dueDate)}
                </span>
              </div>
            ))
          )}
        </section>

        <section className="card dash__panel">
          <h2 className="dash__panelTitle">
            <Icon name="shield" size={15} /> Needs attention
          </h2>
          <div className="cal__stat">
            <span>Overdue</span>
            <strong data-overdue={period.overdue > 0}>{period.overdue}</strong>
          </div>
        </section>
      </aside>

      {(creatingOn !== null || editing) && (
        <TaskForm
          existing={editing}
          initialStatus="todo"
          initialDueDate={creatingOn}
          onClose={() => {
            setCreatingOn(null)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreatingOn(null)
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}
