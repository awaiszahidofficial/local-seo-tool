/** True when a URL hash fragment carries a Supabase password-recovery session (implicit flow). */
export function isRecoveryUrl(hash: string): boolean {
  const params = new URLSearchParams(hash.replace(/^#/, ''))
  return params.get('type') === 'recovery'
}

/**
 * Only allow same-origin, in-app paths as post-login redirect targets, so a crafted
 * link cannot send a user to another site (open redirect).
 */
export function safeRedirectPath(value: unknown, fallback = '/'): string {
  if (typeof value !== 'string') return fallback
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return fallback
  if (/^\/(sign-in|sign-up|forgot-password|reset-password)(\/|$|\?)/.test(value)) return fallback
  return value
}
