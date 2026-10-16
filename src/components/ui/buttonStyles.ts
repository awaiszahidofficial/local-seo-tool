export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white shadow-sm shadow-accent/20 hover:bg-accent-strong focus-visible:outline-accent',
  secondary:
    'border border-line-strong bg-surface text-ink hover:border-ink-3 hover:bg-surface-2 focus-visible:outline-accent',
  danger: 'bg-bad-fill text-white shadow-sm hover:bg-bad-fill/90 focus-visible:outline-bad',
  ghost: 'text-ink-2 hover:bg-subtle focus-visible:outline-accent',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
}

export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  className = '',
): string {
  return [BASE, VARIANTS[variant], SIZES[size], className].filter(Boolean).join(' ')
}
