import type { ReactNode } from 'react'

type PageHeaderProps = {
  title: string
  description?: string
  actions?: ReactNode
  /** Small element rendered above the title, such as a back link. */
  eyebrow?: ReactNode
}

export function PageHeader({ title, description, actions, eyebrow }: PageHeaderProps) {
  return (
    <header className="mb-8">
      {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight font-semibold tracking-[-0.015em] text-ink">{title}</h1>
          {description ? <p className="mt-2 max-w-2xl text-[15px] leading-relaxed text-ink-3">{description}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  )
}
