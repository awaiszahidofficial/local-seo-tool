import type { ReactNode } from 'react'
import { Icon, type IconName } from '../icons'

type EmptyStateProps = {
  icon?: IconName
  title: string
  description: string
  action?: ReactNode
}

export function EmptyState({ icon = 'folder', title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center px-6 py-14 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-accent-soft text-accent-ink">
        <Icon name={icon} className="size-6" />
      </span>
      <h2 className="mt-4 text-base font-semibold text-ink">{title}</h2>
      <p className="mt-1 max-w-md text-sm text-ink-2">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}
