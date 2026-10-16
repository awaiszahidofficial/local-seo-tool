import type { ReactNode } from 'react'
import { BrandMark } from './BrandMark'

type AuthLayoutProps = {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}

export function AuthLayout({ title, description, children, footer }: AuthLayoutProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <main className="w-full max-w-md">
        <BrandMark className="mb-8 justify-center" />
        <div className="rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? <p className="mt-1 text-sm text-ink-2">{description}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        {footer ? <div className="mt-5 text-center text-sm text-ink-2">{footer}</div> : null}
      </main>
    </div>
  )
}
