import { createContext, useContext } from 'react'

export type Toast = {
  id: string
  message: string
  tone?: 'success' | 'error' | 'info'
}

export type ToastContextValue = {
  pushToast: (message: string, tone?: Toast['tone']) => void
}

export const ToastContext = createContext<ToastContextValue | null>(null)

export function useToasts(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('Toast context missing')
  return ctx
}
