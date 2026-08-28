/**
 * Sanctum's window, rebuilt from the app's own tokens (U4: R6, R7).
 *
 * Not a screenshot and not an approximation: every colour, radius, spacing
 * step and font here resolves from `src/theme/tokens.css`, the same file the
 * desktop app loads. Change an accent in the app and this changes with it.
 *
 * Rendered to static HTML at build time - no `client:` directive, so the site
 * ships no JavaScript for any of it.
 */

export type Module =
  | 'Dashboard'
  | 'Vault'
  | 'Env Files'
  | 'Notes'
  | 'Tasks'
  | 'Calendar'
  | 'Income'

const MODULES: Module[] = [
  'Dashboard',
  'Vault',
  'Env Files',
  'Notes',
  'Tasks',
  'Calendar',
  'Income',
]

const TOOLS = ['Folders', 'Favorites', 'Generate Password']

interface Props {
  active: Module
  children: React.ReactNode
  /** Shrinks the chrome for the smaller vignettes beside body copy. */
  compact?: boolean
}

export function AppFrame({ active, children, compact = false }: Props) {
  return (
    <div className={compact ? 'frame frame--compact' : 'frame'} aria-hidden="true">
      <div className="frame__titlebar">
        <span className="frame__brand">
          <span className="frame__mark" />
          Sanctum
        </span>
        <span className="frame__search">Search</span>
        <span className="frame__windowControls">
          <i />
          <i />
          <i />
        </span>
      </div>

      <div className="frame__body">
        <aside className="frame__sidebar">
          <div className="frame__you">
            <span className="frame__avatar" />
            You
          </div>

          <p className="frame__label">Modules</p>
          {MODULES.map((name) => (
            <span
              key={name}
              className="frame__nav"
              data-on={name === active}
            >
              {name}
            </span>
          ))}

          <p className="frame__label">Tools</p>
          {TOOLS.map((name) => (
            <span key={name} className="frame__nav">
              {name}
            </span>
          ))}
        </aside>

        <main className="frame__content">{children}</main>
      </div>
    </div>
  )
}
