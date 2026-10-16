import { Spinner } from './ui/Spinner'

export function FullPageSpinner({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex min-h-screen items-center justify-center gap-3 text-sm text-ink-2">
      <Spinner className="size-5 text-accent-ink" />
      <span>{label}</span>
    </div>
  )
}
