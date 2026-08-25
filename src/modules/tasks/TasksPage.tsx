/**
 * Tasks (U15: R28, R29, AE7).
 *
 * Grouped by status with collapsible sections and counts, matching the
 * reference. Sorting and filtering run over the already-decrypted list, same
 * as the vault — every text field is encrypted at rest, so SQL cannot help.
 */
import { useEffect, useMemo, useState } from 'react'

import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { formatDay, isOverdue } from '../../lib/format'
import { CommandError, tasks, type Task, type TaskPriority, type TaskStatus } from '../../lib/ipc'
import { TaskForm } from './TaskForm'
import './tasks.css'

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'To Do' },
  { status: 'in_progress', label: 'In Progress' },
  { status: 'completed', label: 'Completed' },
]

const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
}

export function TasksPage() {
  const [items, setItems] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [tag, setTag] = useState('')
  const [sort, setSort] = useState<'due' | 'priority'>('due')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({ completed: true })
  const [detail, setDetail] = useState<Task | null>(null)
  const [editing, setEditing] = useState<Task | null>(null)
  const [creating, setCreating] = useState<TaskStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    setLoading(true)
    try {
      setItems(await tasks.list())
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

  const allTags = useMemo(() => {
    const set = new Set<string>()
    for (const task of items) for (const t of task.tags) set.add(t)
    return [...set].sort()
  }, [items])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = items.filter((task) => {
      if (tag && !task.tags.includes(tag)) return false
      if (!needle) return true
      return (
        task.title.toLowerCase().includes(needle) ||
        task.description.toLowerCase().includes(needle) ||
        task.tags.some((t) => t.toLowerCase().includes(needle))
      )
    })

    if (sort === 'priority') {
      const rank: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 }
      return [...filtered].sort((a, b) => rank[a.priority] - rank[b.priority])
    }
    return filtered
  }, [items, query, tag, sort])

  const openCount = items.filter((task) => task.status !== 'completed').length

  async function toggleDone(task: Task) {
    await tasks.setStatus(task.id, task.status === 'completed' ? 'todo' : 'completed')
    await load()
  }

  async function remove(id: string) {
    await tasks.remove(id)
    setDetail(null)
    await load()
  }

  return (
    <div data-testid="route-tasks">
      <header className="page__head">
        <h1 className="page__title">My Task</h1>
        <p className="page__sub">
          {openCount === 0
            ? 'Nothing open. Add a task to get started.'
            : `You have ${openCount} open task${openCount === 1 ? '' : 's'}. Stay focused and complete them one at a time.`}
        </p>
      </header>

      <div className="toolbar">
        <div className="toolbar__search">
          <Icon name="search" />
          <input
            className="toolbar__input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search tasks"
            aria-label="Search tasks"
          />
        </div>

        <select
          className="input toolbar__tags"
          value={sort}
          onChange={(event) => setSort(event.target.value as 'due' | 'priority')}
          aria-label="Sort tasks"
        >
          <option value="due">Due date</option>
          <option value="priority">Priority</option>
        </select>

        <select
          className="input toolbar__tags"
          value={tag}
          onChange={(event) => setTag(event.target.value)}
          aria-label="Filter tasks by tag"
        >
          <option value="">All tags</option>
          {allTags.map((t) => (
            <option key={t} value={t}>
              #{t}
            </option>
          ))}
        </select>

        <button className="toolbar__add" onClick={() => setCreating('todo')} aria-label="New task">
          <Icon name="plus" />
        </button>
      </div>

      {error && <p className="vault__error">{error}</p>}

      {loading ? (
        <div className="card page__empty">
          <p>Decrypting…</p>
        </div>
      ) : (
        GROUPS.map((group) => {
          const groupItems = visible.filter((task) => task.status === group.status)
          const isCollapsed = collapsed[group.status] ?? false

          return (
            <section className="tgroup" key={group.status}>
              <header className="tgroup__head">
                <button
                  className="tgroup__toggle"
                  onClick={() =>
                    setCollapsed({ ...collapsed, [group.status]: !isCollapsed })
                  }
                  aria-expanded={!isCollapsed}
                >
                  <span className="tgroup__dot" data-status={group.status} aria-hidden="true" />
                  <span className="tgroup__label">{group.label}</span>
                  <span className="tgroup__count">{groupItems.length}</span>
                  <Icon name="chevron-down" size={14} />
                </button>
                <button
                  className="iconbtn"
                  onClick={() => setCreating(group.status)}
                  aria-label={`Add a task to ${group.label}`}
                >
                  <Icon name="plus" />
                </button>
              </header>

              {!isCollapsed &&
                (groupItems.length === 0 ? (
                  <p className="tgroup__empty">No tasks.</p>
                ) : (
                  <div className="card tgroup__list">
                    <div className="trow trow--header">
                      <span />
                      <span className="label">Task</span>
                      <span className="label">Description</span>
                      <span className="label">Due date</span>
                      <span className="label">Priority</span>
                      <span />
                    </div>
                    {groupItems.map((task) => (
                      <div className="trow" key={task.id}>
                        <input
                          type="checkbox"
                          checked={task.status === 'completed'}
                          onChange={() => void toggleDone(task)}
                          aria-label={`Mark ${task.title} ${task.status === 'completed' ? 'not done' : 'done'}`}
                        />
                        <button className="trow__title" onClick={() => setDetail(task)}>
                          {task.title}
                        </button>
                        <span className="trow__desc">{task.description}</span>
                        <span className="trow__due">
                          {task.dueDate === null ? (
                            '—'
                          ) : (
                            <span
                              className="chip"
                              data-overdue={
                                task.status !== 'completed' && isOverdue(task.dueDate)
                              }
                            >
                              <Icon name="calendar" size={12} />
                              {formatDay(task.dueDate)}
                            </span>
                          )}
                        </span>
                        <span className={`pill pill--${task.priority}`}>
                          {PRIORITY_LABEL[task.priority]}
                        </span>
                        <button
                          className="iconbtn"
                          onClick={() => setEditing(task)}
                          aria-label={`Edit ${task.title}`}
                        >
                          <Icon name="edit" />
                        </button>
                      </div>
                    ))}
                  </div>
                ))}
            </section>
          )
        })
      )}

      {detail && (
        <Modal
          title={detail.title}
          onClose={() => setDetail(null)}
          footer={
            <>
              <button className="btn" onClick={() => setDetail(null)}>
                Close
              </button>
              <button
                className="btn btn-danger"
                onClick={() => void remove(detail.id)}
              >
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
          <div className="field__box tdetail__status">
            <span>
              <span className="label field__label">Status</span>
              <span className="field__value">
                {GROUPS.find((g) => g.status === detail.status)?.label}
              </span>
            </span>
            <span className={`pill pill--${detail.priority}`}>
              {PRIORITY_LABEL[detail.priority]}
            </span>
          </div>

          <div className="field__row">
            <div className="field">
              <span className="label field__label">Due date</span>
              <p className="field__value">
                {detail.dueDate === null ? '—' : formatDay(detail.dueDate)}
              </p>
            </div>
            <div className="field">
              <span className="label field__label">Tags</span>
              <p className="field__value">
                {detail.tags.length > 0 ? detail.tags.map((t) => `#${t}`).join(', ') : '—'}
              </p>
            </div>
          </div>

          <div className="field">
            <span className="label field__label">Description</span>
            <div className="field__box">{detail.description || '—'}</div>
          </div>
        </Modal>
      )}

      {(creating !== null || editing) && (
        <TaskForm
          existing={editing}
          initialStatus={creating ?? 'todo'}
          onClose={() => {
            setCreating(null)
            setEditing(null)
          }}
          onSaved={async () => {
            setCreating(null)
            setEditing(null)
            await load()
          }}
        />
      )}
    </div>
  )
}
