import type { ReactNode } from 'react'

type CardProps = {
  children: ReactNode
  className?: string
  as?: 'div' | 'section'
  'aria-labelledby'?: string
}

export function Card({ children, className = '', as: Tag = 'div', ...rest }: CardProps) {
  return (
    <Tag className={`rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgb(15_23_42/0.05)] dark:shadow-none ${className}`.trim()} {...rest}>
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
    <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-line-soft px-5 py-4">
      <div className="min-w-0">
        <h2 id={id} className="text-[15px] font-semibold text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 max-w-3xl text-sm text-ink-3">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
