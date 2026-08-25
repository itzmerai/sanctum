/**
 * The unlock window's root (U4).
 *
 * Decides between setup, lock, and recovery from the vault's actual state
 * rather than from navigation history — a half-finished setup (vault created,
 * recovery code never acknowledged) must resume at the code, not skip it.
 *
 * On success it shows the main window and hides itself. Two real windows
 * rather than one that swaps its contents, so the unlock surface runs under
 * its own locked-down capability set (KTD18).
 */
import { useCallback, useEffect, useState } from 'react'

import { hasBackend, session } from '../../lib/ipc'
import { LockScreen } from './LockScreen'
import { RecoveryScreen } from './RecoveryScreen'
import { SetupScreen } from './SetupScreen'

type Phase = 'loading' | 'setup' | 'locked' | 'recovery' | 'done'

export function UnlockWindow() {
  const [phase, setPhase] = useState<Phase>('loading')

  useEffect(() => {
    if (!hasBackend()) {
      // Running in a plain browser (vite preview): show the lock screen so the
      // layout can be inspected without a Rust backend.
      setPhase('locked')
      return
    }
    void session
      .status()
      .then((status) => {
        if (!status.initialized) setPhase('setup')
        else if (!status.recoveryAcknowledged && !status.locked) setPhase('setup')
        else setPhase('locked')
      })
      .catch(() => setPhase('locked'))
  }, [])

  // The window swap itself happens in Rust, as part of the command that
  // installed the DEK -- see commands::windows. This only has to stop
  // rendering the unlock surface.
  const enterApp = useCallback(() => {
    setPhase('done')
  }, [])

  switch (phase) {
    case 'loading':
      return <div className="lock" data-tauri-drag-region />
    case 'setup':
      return <SetupScreen onComplete={enterApp} />
    case 'recovery':
      return (
        <RecoveryScreen onUnlocked={enterApp} onCancel={() => setPhase('locked')} />
      )
    case 'done':
      // Deliberately blank: Rust is hiding this window, and rendering the
      // lock screen here would flash a password prompt at someone who just
      // successfully unlocked.
      return <div className="lock" data-tauri-drag-region />
    case 'locked':
      return (
        <LockScreen onUnlocked={enterApp} onForgotPassword={() => setPhase('recovery')} />
      )
  }
}
