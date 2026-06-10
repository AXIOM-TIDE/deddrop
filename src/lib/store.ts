/**
 * Global session state for DEDDROP
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface ZkLoginSession {
  address: string
  maxEpoch: number
  salt: string
  proof?: unknown
  addressSeed?: string
}

interface DropStore {
  // zkLogin session
  session: ZkLoginSession | null
  setSession: (s: ZkLoginSession | null) => void

  // User's on-chain objects (fetched lazily after login)
  harborId: string | null
  vesselId: string | null
  setHarborId: (id: string | null) => void
  setVesselId: (id: string | null) => void

  // Pending drop (creator flow — survives page refresh)
  pendingDrop: {
    hook: string
    priceDisplay: string
    ciphertext: number[]  // stored as array for JSON serialization
    keyB64: string
  } | null
  setPendingDrop: (d: DropStore['pendingDrop']) => void

  // Pending unlock (buyer flow — txDigest after read())
  pendingUnlock: {
    castId: string
    txDigest: string
  } | null
  setPendingUnlock: (u: DropStore['pendingUnlock']) => void
}

export const useStore = create<DropStore>()(
  persist(
    (set) => ({
      session: null,
      setSession: (session) => set({ session }),

      harborId: null,
      vesselId: null,
      setHarborId: (harborId) => set({ harborId }),
      setVesselId: (vesselId) => set({ vesselId }),

      pendingDrop: null,
      setPendingDrop: (pendingDrop) => set({ pendingDrop }),

      pendingUnlock: null,
      setPendingUnlock: (pendingUnlock) => set({ pendingUnlock }),
    }),
    {
      name: 'deddrop-store',
      // Don't persist the ZK proof across sessions (epoch-bound)
      partialize: (state) => ({
        harborId: state.harborId,
        vesselId: state.vesselId,
        pendingDrop: state.pendingDrop,
        pendingUnlock: state.pendingUnlock,
      }),
    }
  )
)
