/**
 * Sanctum's window, rebuilt from the app's own parts (U4: R6, R7).
 *
 * Not a screenshot and not a lookalike. The icons are the app's `Icon`
 * component, the colours are the app's tokens, and the tile tints come from
 * the app's `tintFor`. Nothing here is a second copy of anything, so the page
 * cannot drift from the product.
 *
 * Rendered to static HTML at build time - no `client:` directive, so the site
 * ships no JavaScript for any of it.
 */
import { Icon, type IconName } from '@app/components/Icon'

export type Module = 'Dashboard' | 'Vault' | 'Env Files' | 'Notes' | 'Tasks' | 'Calendar' | 'Income'

const MODULES: { name: Module; icon: IconName }[] = [
  { name: 'Dashboard', icon: 'dashboard' },
  { name: 'Vault', icon: 'key' },
  { name: 'Env Files', icon: 'note' },
  { name: 'Notes', icon: 'note' },
  { name: 'Tasks', icon: 'task' },
  { name: 'Calendar', icon: 'calendar' },
  { name: 'Income', icon: 'income' },
]

const TOOLS: { name: string; icon: IconName }[] = [
  { name: 'Folders', icon: 'folder' },
  { name: 'Favorites', icon: 'star' },
  { name: 'Generate Password', icon: 'wand' },
]

const FOOTER: { name: string; icon: IconName }[] = [
  { name: 'Activity Log', icon: 'history' },
  { name: 'Settings', icon: 'settings' },
  { name: 'Lock', icon: 'lock' },
]

interface Props {
  active: Module
  children: React.ReactNode
  /** Drops the sidebar for the smaller vignettes beside body copy. */
  compact?: boolean
}

export function AppFrame({ active, children, compact = false }: Props) {
  return (
    <div className={compact ? 'frame frame--compact' : 'frame'} aria-hidden="true">
      <div className="frame__titlebar">
        <span className="frame__left">
          <Icon name="menu" size={16} />
          <span className="frame__brand">
            <Icon name="lock" size={13} />
            Sanctum
          </span>
        </span>

        <span className="frame__search">
          <Icon name="search" size={13} />
          Search
          <kbd className="frame__kbd">Ctrl K</kbd>
        </span>

        <span className="frame__windowControls">
          <i className="frame__min" />
          <i className="frame__max" />
          <Icon name="close" size={13} />
        </span>
      </div>

      <div className="frame__body">
        {!compact && (
          <aside className="frame__sidebar">
            <div className="frame__you">
              <span className="frame__avatar">
                <Icon name="lock" size={12} />
              </span>
              You
              <Icon name="sun" size={14} className="frame__themeIcon" />
            </div>

            <p className="frame__label">Modules</p>
            {MODULES.map((item) => (
              <span key={item.name} className="frame__nav" data-on={item.name === active}>
                <Icon name={item.icon} size={15} />
                {item.name}
              </span>
            ))}

            <p className="frame__label">Tools</p>
            {TOOLS.map((item) => (
              <span key={item.name} className="frame__nav">
                <Icon name={item.icon} size={15} />
                {item.name}
              </span>
            ))}

            <div className="frame__spacer" />

            {FOOTER.map((item) => (
              <span key={item.name} className="frame__nav">
                <Icon name={item.icon} size={15} />
                {item.name}
              </span>
            ))}
          </aside>
        )}

        <main className="frame__content">{children}</main>
      </div>
    </div>
  )
}
