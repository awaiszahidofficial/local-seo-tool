import type { ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

export type AlertVariant = 'error' | 'success' | 'info' | 'warning'

const STYLES: Record<AlertVariant, { box: string; icon: IconName }> = {
  error: { box: 'border-red-200 bg-red-50 text-red-900', icon: 'alert' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-900', icon: 'check' },
  info: { box: 'border-indigo-200 bg-indigo-50 text-indigo-900', icon: 'info' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-900', icon: 'alert' },
}

type AlertProps = {
  variant?: AlertVariant
  title?: string
  children: ReactNode
  className?: string
}

/** Errors use role="alert" (announced immediately); other variants use role="status" (polite). */
export function Alert({ variant = 'info', title, children, className = '' }: AlertProps) {
  const style = STYLES[variant]
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${style.box} ${className}`.trim()}
    >
      <Icon name={style.icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  )
}
