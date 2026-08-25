import { HashRouter, MemoryRouter, Navigate, Route, Routes } from 'react-router'

import { Shell } from './components/shell/Shell'
import { ActivityPage } from './modules/activity/ActivityPage'
import { DashboardPage } from './modules/dashboard/DashboardPage'
import { FavoritesPage } from './modules/favorites/FavoritesPage'
import { FoldersPage } from './modules/folders/FoldersPage'
import { GeneratorPage } from './modules/generator/GeneratorPage'
import { IncomePage } from './modules/income/IncomePage'
import { NotesPage } from './modules/notes/NotesPage'
import { SettingsPage } from './modules/settings/SettingsPage'
import { TasksPage } from './modules/tasks/TasksPage'
import { UnlockWindow } from './modules/unlock/UnlockWindow'
import { VaultPage } from './modules/vault/VaultPage'
import { CalendarPage } from './modules/calendar/CalendarPage'

/**
 * Hash routing, not browser routing: the packaged app is served from Tauri's
 * custom protocol, where a path-based reload has no server to resolve it.
 *
 * Declarative mode, not Data mode (KTD17 permits either). Data mode's loaders,
 * actions and fetchers exist to coordinate with a server; Sanctum has none --
 * every read and write crosses the Tauri IPC boundary instead.
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

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/vault" element={<VaultPage />} />
        <Route path="/notes" element={<NotesPage />} />
        <Route path="/tasks" element={<TasksPage />} />
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/income" element={<IncomePage />} />
        <Route path="/folders" element={<FoldersPage />} />
        <Route path="/favorites" element={<FavoritesPage />} />
        <Route path="/generate" element={<GeneratorPage />} />
        <Route path="/activity" element={<ActivityPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Route>
    </Routes>
  )
}

export function UnlockRoutes() {
  return (
    <Routes>
      <Route path="*" element={<UnlockWindow />} />
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
