/**
 * Create / edit a task (U15: R28).
 */
import { useState } from 'react'

import { Modal } from '../../components/Modal'
import { formatIsoDate, parseIsoDate } from '../../lib/format'
import { CommandError, tasks, type Task, type TaskPriority, type TaskStatus } from '../../lib/ipc'

const STATUSES: { value: TaskStatus; label: string }[] = [
  { value: 'todo', label: 'To Do' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'completed', label: 'Completed' },
]

const PRIORITIES: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
]

interface Props {
  existing: Task | null
  initialStatus: TaskStatus
  /** Pre-fills the due date when creating from a calendar day. */
  initialDueDate?: number | null
  onClose: () => void
  onSaved: () => void | Promise<void>
}

export function TaskForm({
  existing,
  initialStatus,
  initialDueDate,
  onClose,
  onSaved,
}: Props) {
  const [title, setTitle] = useState(existing?.title ?? '')
  const [description, setDescription] = useState(existing?.description ?? '')
  const [status, setStatus] = useState<TaskStatus>(existing?.status ?? initialStatus)
  const [priority, setPriority] = useState<TaskPriority>(existing?.priority ?? 'medium')
  const [due, setDue] = useState(
    existing?.dueDate
      ? formatIsoDate(existing.dueDate)
      : initialDueDate
        ? formatIsoDate(initialDueDate)
        : '',
  )
  const [tagText, setTagText] = useState(existing?.tags.join(', ') ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSave = title.trim().length > 0 && !busy

  async function save(event: React.FormEvent) {
    event.preventDefault()
    if (!canSave) return

    setBusy(true)
    setError(null)
    try {
      const input = {
        title: title.trim(),
        description,
        tags: tagText
          .split(',')
          .map((tag) => tag.trim().replace(/^#/, ''))
          .filter(Boolean),
        status,
        priority,
        dueDate: due ? parseIsoDate(due) : null,
      }

      if (existing) await tasks.update(existing.id, input)
      else await tasks.create(input)

      await onSaved()
    } catch (raw) {
      setError(raw instanceof CommandError ? raw.message : String(raw))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={existing ? 'Edit task' : 'New task'}
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="task-form" className="btn btn-primary" disabled={!canSave}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="task-form" onSubmit={save}>
        <div className="field">
          <label className="label field__label" htmlFor="tf-title">
            Task
          </label>
          <input
            id="tf-title"
            className="input"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Renew the developer certificate"
            required
            autoFocus
          />
        </div>

        <div className="field">
          <label className="label field__label" htmlFor="tf-desc">
            Description
          </label>
          <textarea
            id="tf-desc"
            className="input"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="What does done look like?"
          />
        </div>

        <div className="field__row">
          <div className="field">
            <label className="label field__label" htmlFor="tf-status">
              Status
            </label>
            <select
              id="tf-status"
              className="input"
              value={status}
              onChange={(event) => setStatus(event.target.value as TaskStatus)}
            >
              {STATUSES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="label field__label" htmlFor="tf-priority">
              Priority
            </label>
            <select
              id="tf-priority"
              className="input"
              value={priority}
              onChange={(event) => setPriority(event.target.value as TaskPriority)}
            >
              {PRIORITIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="field__row">
          <div className="field">
            <label className="label field__label" htmlFor="tf-due">
              Due date
            </label>
            <input
              id="tf-due"
              className="input"
              type="date"
              value={due}
              onChange={(event) => setDue(event.target.value)}
            />
          </div>

          <div className="field">
            <label className="label field__label" htmlFor="tf-tags">
              Tags
            </label>
            <input
              id="tf-tags"
              className="input"
              value={tagText}
              onChange={(event) => setTagText(event.target.value)}
              placeholder="nextjs, performance"
            />
          </div>
        </div>

        {error && (
          <p className="form__hint" data-error="true" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  )
}
