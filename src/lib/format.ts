export type FormatDateOptions = {
  /** IANA time zone, e.g. "UTC". Defaults to the viewer's local time zone. */
  timeZone?: string
  locale?: string
}

const EMPTY_VALUE = '—'

/** Formats an ISO timestamp as e.g. "Oct 15, 2026". Returns "—" for missing or invalid input. */
export function formatDate(
  value: string | Date | null | undefined,
  options: FormatDateOptions = {},
): string {
  if (value === null || value === undefined || value === '') return EMPTY_VALUE
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return EMPTY_VALUE

  return new Intl.DateTimeFormat(options.locale ?? 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: options.timeZone,
  }).format(date)
}
