/** Digits only, for comparing phone numbers regardless of formatting; uses the last 10 digits when longer. */
export function phoneKey(value: string): string {
  const digits = value.replace(/\D/g, '')
  return digits.length > 10 ? digits.slice(-10) : digits
}
