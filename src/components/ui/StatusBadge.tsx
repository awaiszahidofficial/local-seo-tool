export type BadgeTone = 'planned' | 'success' | 'neutral' | 'warning' | 'danger'

const TONES: Record<BadgeTone, string> = {
  planned: 'bg-subtle text-ink-2 ring-line-strong',
  success: 'bg-good-soft text-good ring-good/25',
  neutral: 'bg-accent-soft text-accent-ink ring-accent/25',
  warning: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-bad-soft text-bad ring-bad/25',
}

const DOT: Record<BadgeTone, string> = {
  planned: 'bg-ink-3',
  success: 'bg-good',
  neutral: 'bg-accent-ink',
  warning: 'bg-warn',
  danger: 'bg-bad',
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: BadgeTone; children: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset ${TONES[tone]}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  )
}
