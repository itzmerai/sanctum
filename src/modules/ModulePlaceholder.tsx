/**
 * Stand-in for a module whose screen has not landed yet.
 *
 * Renders the real page heading and subtitle from the reference so the shell,
 * navigation and theming can be judged now, and names the unit that will
 * replace it — an honest "not built yet" rather than a screen that looks
 * finished and does nothing.
 */
import { Icon } from '../components/Icon'

interface Props {
  title: string
  blurb: string
  unit: string
  routeKey: string
}

export function ModulePlaceholder({ title, blurb, unit, routeKey }: Props) {
  return (
    <div data-testid={`route-${routeKey}`}>
      <header className="page__head">
        <h1 className="page__title">{title}</h1>
        <p className="page__sub">{blurb}</p>
      </header>

      <div className="card page__empty">
        <Icon name="clock" size={22} />
        <p>
          This screen arrives with <strong>{unit}</strong>. The shell, theming and
          navigation around it are live.
        </p>
      </div>
    </div>
  )
}
