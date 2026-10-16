import type { ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

export type AlertVariant = 'error' | 'success' | 'info' | 'warning'

const STYLES: Record<AlertVariant, { box: string; icon: IconName }> = {
  error: { box: 'border-bad/30 bg-bad-soft text-bad', icon: 'alert' },
  success: { box: 'border-good/30 bg-good-soft text-good', icon: 'check' },
  info: { box: 'border-accent/30 bg-accent-soft text-accent-ink', icon: 'info' },
  warning: { box: 'border-warn/30 bg-warn-soft text-warn', icon: 'alert' },
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
      className={`flex gap-3 rounded-lg border px-4 py-3 text-sm leading-relaxed ${style.box} ${className}`.trim()}
    >
      <Icon name={style.icon} className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0">
        {title ? <p className="font-semibold">{title}</p> : null}
        <div className={title ? 'mt-0.5' : undefined}>{children}</div>
      </div>
    </div>
  )
}
