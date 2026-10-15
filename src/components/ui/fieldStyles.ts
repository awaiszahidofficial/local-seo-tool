export function controlClasses(hasError: boolean): string {
  return [
    'block w-full rounded-lg border bg-white px-3 py-2 text-sm text-slate-900 shadow-sm',
    'placeholder:text-slate-400 focus:outline-2 focus:outline-offset-0',
    'disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500',
    hasError
      ? 'border-red-500 focus:border-red-600 focus:outline-red-600/30'
      : 'border-slate-300 focus:border-indigo-600 focus:outline-indigo-600/30',
  ].join(' ')
}
