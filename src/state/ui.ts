import { create } from 'zustand'
import { currentMonth } from '../lib/dates'
import type { Id, MonthKey } from '../types'
import { uid } from '../lib/id'

export interface Toast {
  id: string
  message: string
  tone?: 'default' | 'danger'
  action?: { label: string; run: () => void }
}

interface UiState {
  month: MonthKey
  setMonth: (m: MonthKey) => void
  stepMonth: (delta: number) => void

  /** Category whose detail drawer is open. */
  detailCategoryId: Id | null
  openCategoryDetail: (id: Id | null) => void

  /** Transaction modal: `'new'` opens a blank one. */
  txnModal: { open: boolean; transactionId?: Id; accountId?: Id; categoryId?: Id } | null
  openTxnModal: (opts?: { transactionId?: Id; accountId?: Id; categoryId?: Id }) => void
  closeTxnModal: () => void

  toasts: Toast[]
  toast: (message: string, opts?: { tone?: Toast['tone']; action?: Toast['action'] }) => void
  dismissToast: (id: string) => void
}

export const useUi = create<UiState>((set, get) => ({
  month: currentMonth(),
  setMonth: (month) => set({ month }),
  stepMonth: (delta) => {
    const [y, m] = get().month.split('-').map(Number)
    const total = y * 12 + (m - 1) + delta
    set({
      month: `${String(Math.floor(total / 12)).padStart(4, '0')}-${String((total % 12) + 1).padStart(2, '0')}`,
    })
  },

  detailCategoryId: null,
  openCategoryDetail: (detailCategoryId) => set({ detailCategoryId }),

  txnModal: null,
  openTxnModal: (opts) => set({ txnModal: { open: true, ...opts } }),
  closeTxnModal: () => set({ txnModal: null }),

  toasts: [],
  toast: (message, opts) => {
    const id = uid('toast')
    set((s) => ({ toasts: [...s.toasts, { id, message, ...opts }] }))
    setTimeout(() => get().dismissToast(id), opts?.action ? 7000 : 3800)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Fire a toast from outside React (action helpers, error handlers). */
export const toast = (message: string, opts?: Parameters<UiState['toast']>[1]) =>
  useUi.getState().toast(message, opts)
