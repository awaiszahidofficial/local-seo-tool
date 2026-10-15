export type BadgeTone = 'planned' | 'success' | 'neutral' | 'warning' | 'danger'

const TONES: Record<BadgeTone, string> = {
  planned: 'bg-slate-100 text-slate-700 ring-slate-300',
  success: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  neutral: 'bg-indigo-50 text-indigo-800 ring-indigo-200',
  warning: 'bg-amber-50 text-amber-900 ring-amber-200',
  danger: 'bg-red-50 text-red-800 ring-red-200',
}

export function StatusBadge({ tone = 'neutral', children }: { tone?: BadgeTone; children: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
