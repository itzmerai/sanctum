import React from 'react'
import ReactDOM from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { Router } from './router'
import './styles/global.css'

/**
 * Two windows share this bundle (KTD18): `unlock` runs under a locked-down
 * capability set, `main` under the broader one. The window label decides which
 * tree mounts, so the unlock surface never renders app routes.
 */
function resolveWindowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    // Running outside Tauri (vitest, `vite dev` in a browser).
    return 'main'
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element #root is missing from index.html')

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Router windowLabel={resolveWindowLabel()} />
  </React.StrictMode>,
)
