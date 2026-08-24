import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router'

/**
 * Hash routing, not browser routing: the packaged app is served from Tauri's
 * custom protocol, where a path-based reload has no server to resolve it.
 *
 * Declarative mode, not Data mode (KTD17 permits either). Data mode's loaders,
 * actions and fetchers exist to coordinate with a server; Sanctum has none --
 * every read and write crosses the Tauri IPC boundary instead. Declarative mode
 * carries none of that machinery.
 *
 * Route elements are filled in by their owning units; U8 mounts the real shell
 * around this table.
 */
const MODULE_PATHS = [
  'dashboard',
  'vault',
  'notes',
  'tasks',
  'calendar',
  'income',
  'folders',
  'favorites',
  'generate',
  'activity',
  'settings',
] as const

export type ModulePath = (typeof MODULE_PATHS)[number]

function Placeholder({ name }: { name: string }) {
  return <main data-testid={`route-${name}`}>{name}</main>
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      {MODULE_PATHS.map((path) => (
        <Route key={path} path={`/${path}`} element={<Placeholder name={path} />} />
      ))}
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  )
}

export function UnlockRoutes() {
  return (
    <Routes>
      <Route path="*" element={<Placeholder name="unlock" />} />
    </Routes>
  )
}

export function Router({ windowLabel }: { windowLabel: string }) {
  return (
    <HashRouter>{windowLabel === 'unlock' ? <UnlockRoutes /> : <AppRoutes />}</HashRouter>
  )
}

/** Test-only harness: routes without the hash-history singleton. */
export function RoutesUnderTest({
  windowLabel,
  initialEntry = '/',
}: {
  windowLabel: string
  initialEntry?: string
}) {
  return (
    <MemoryRouter initialEntries={[initialEntry]}>
      {windowLabel === 'unlock' ? <UnlockRoutes /> : <AppRoutes />}
    </MemoryRouter>
  )
}

export { MODULE_PATHS }
