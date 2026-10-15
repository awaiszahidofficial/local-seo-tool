import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
  'aria-labelledby'?: string
}

export function Card({ children, className = '', as: Tag = 'div', ...rest }: CardProps) {
  return (
    <Tag className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`.trim()} {...rest}>
      {children}
    </Tag>
  )
}

type CardHeaderProps = {
  id?: string
  title: string
  description?: string
  action?: ReactNode
}

export function CardHeader({ id, title, description, action }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-base font-semibold text-slate-900">
          {title}
        </h2>
        {description ? <p className="mt-0.5 text-sm text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
