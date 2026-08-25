// Stylesheets first, and before any module that pulls in a component
// stylesheet. ES imports are hoisted in source order, so a component's CSS
// would otherwise load ahead of the tokens it overrides -- and since class
// selectors like `.input` and `.lock__input` share a specificity, source order
// is what decides the winner.
import './theme/tokens.css'
import './styles/global.css'

import React from 'react'
import ReactDOM from 'react-dom/client'
import { getCurrentWindow } from '@tauri-apps/api/window'

import { Router } from './router'

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
