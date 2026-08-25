/**
 * Minimise / maximise / close (R4).
 *
 * Both windows run with `decorations: false` so the app can draw the title bar
 * from the reference. That means the operating system draws no buttons either,
 * and without these the only way out is Alt+F4 or the taskbar.
 *
 * Rendered as no-ops outside Tauri so the shell still works in a browser.
 */
import { useEffect, useState } from 'react'

import { hasBackend } from '../lib/ipc'

type Action = 'minimize' | 'toggleMaximize' | 'close'

async function run(action: Action): Promise<void> {
  if (!hasBackend()) return
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  const win = getCurrentWindow()
  if (action === 'minimize') await win.minimize()
  else if (action === 'toggleMaximize') await win.toggleMaximize()
  else await win.close()
}

export function WindowControls({ maximizable = true }: { maximizable?: boolean }) {
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    // The unlock window is not maximizable and its capability set does not
    // grant `is-maximized`, so it must not ask.
    if (!hasBackend() || !maximizable) return
    let unlisten: (() => void) | undefined

    void import('@tauri-apps/api/window').then(async ({ getCurrentWindow }) => {
      const win = getCurrentWindow()
      setMaximized(await win.isMaximized())
      // The window can also be maximised by dragging to the top edge or by
      // double-clicking the bar, so the glyph follows the window rather than
      // only this button.
      unlisten = await win.onResized(async () => setMaximized(await win.isMaximized()))
    })

    return () => unlisten?.()
  }, [maximizable])

  return (
    <div className="wincontrols">
      <button
        className="wincontrol"
        onClick={() => void run('minimize')}
        aria-label="Minimise"
        title="Minimise"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>

      {maximizable && (
        <button
          className="wincontrol"
          onClick={() => void run('toggleMaximize')}
          aria-label={maximized ? 'Restore' : 'Maximise'}
          title={maximized ? 'Restore' : 'Maximise'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
            {maximized ? (
              <>
                <rect x="0.5" y="2.5" width="6" height="6" stroke="currentColor" />
                <path d="M2.5 2.5V0.5h6v6h-2" stroke="currentColor" />
              </>
            ) : (
              <rect x="0.5" y="0.5" width="9" height="9" stroke="currentColor" />
            )}
          </svg>
        </button>
      )}

      <button
        className="wincontrol wincontrol--close"
        onClick={() => void run('close')}
        aria-label="Close"
        title="Close"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 0l10 10M10 0L0 10" stroke="currentColor" strokeWidth="1" />
        </svg>
      </button>
    </div>
  )
}
