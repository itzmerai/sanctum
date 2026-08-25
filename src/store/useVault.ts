/**
 * Vault session state (U4/U8, KTD15).
 *
 * **This store is wiped on lock.** Not hidden, not marked stale -- cleared.
 * The Verification Contract requires that after re-lock, no previously
 * decrypted value is retrievable from the WebView, and the only way to keep
 * that promise is to hold decrypted data in exactly one place and empty it.
 *
 * Nothing here is persisted. A `localStorage`-backed cache of decrypted
 * records would survive lock, survive quit, and sit in plaintext on disk --
 * defeating the entire storage layer.
 */
import { create } from 'zustand'

import { CommandError, type Credential, type VaultStatus, credentials, session } from '../lib/ipc'

interface VaultState {
  status: VaultStatus | null
  credentials: Credential[]
  loading: boolean
  error: string | null

  refreshStatus: () => Promise<VaultStatus | null>
  loadCredentials: () => Promise<void>
  /** Clears every decrypted value from memory. Called on lock. */
  clearDecrypted: () => void
  lock: () => Promise<void>
}

export const useVault = create<VaultState>()((set, get) => ({
  status: null,
  credentials: [],
  loading: false,
  error: null,

  refreshStatus: async () => {
    try {
      const status = await session.status()
      set({ status })
      // A vault that locked itself while we were away must not leave stale
      // decrypted rows on screen.
      if (status.locked && get().credentials.length > 0) {
        set({ credentials: [] })
      }
      return status
    } catch (error) {
      set({ error: error instanceof Error ? error.message : String(error) })
      return null
    }
  },

  loadCredentials: async () => {
    set({ loading: true, error: null })
    try {
      set({ credentials: await credentials.list(), loading: false })
    } catch (error) {
      // A `locked` failure is not an error to show -- it is the expected
      // outcome of the auto-lock timer firing between render and fetch.
      if (error instanceof CommandError && error.kind === 'locked') {
        set({ credentials: [], loading: false })
        void get().refreshStatus()
        return
      }
      set({
        loading: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  },

  clearDecrypted: () => set({ credentials: [], error: null }),

  lock: async () => {
    await session.lock()
    get().clearDecrypted()
    await get().refreshStatus()
  },
}))
