export function controlClasses(hasError: boolean): string {
  return [
    'block w-full rounded-lg border bg-surface-2 px-3 py-2 text-sm text-ink',
    'placeholder:text-ink-3 focus:outline-2 focus:outline-offset-0',
    'disabled:cursor-not-allowed disabled:bg-subtle disabled:text-ink-3',
    hasError
      ? 'border-bad focus:border-bad focus:outline-bad/40'
      : 'border-line-strong focus:border-accent focus:outline-accent/40',
  ].join(' ')
}
