type ErrorLike = {
  message?: unknown
  code?: unknown
  status?: unknown
  name?: unknown
}

function asErrorLike(error: unknown): ErrorLike {
  return typeof error === 'object' && error !== null ? (error as ErrorLike) : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const NETWORK_ERROR = 'Could not reach the server. Check your connection and try again.'

function isNetworkError(error: ErrorLike): boolean {
  const message = text(error.message).toLowerCase()
  return (
    text(error.name) === 'AuthRetryableFetchError' ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed')
  )
}

/** Maps Supabase Auth errors to short, user-friendly messages. */
export function getAuthErrorMessage(error: unknown): string {
  const err = asErrorLike(error)
  const code = text(err.code).toLowerCase()
  const message = text(err.message).toLowerCase()

  if (isNetworkError(err)) return NETWORK_ERROR
  if (code === 'invalid_credentials' || message.includes('invalid login credentials')) {
    return 'The email or password is incorrect.'
  }
  if (code === 'email_not_confirmed' || message.includes('email not confirmed')) {
    return 'Please confirm your email address before signing in. Check your inbox for the confirmation link.'
  }
  if (code === 'user_already_exists' || message.includes('already registered')) {
    return 'An account with this email already exists. Try signing in instead.'
  }
  if (code === 'weak_password') {
    return 'That password is too weak. Use at least 8 characters including letters and numbers.'
  }
  if (code === 'same_password') return 'Choose a password that is different from your current one.'
  if (code === 'signup_disabled') return 'New sign-ups are currently disabled.'
  if (
    code === 'over_request_rate_limit' ||
    code === 'over_email_send_rate_limit' ||
    err.status === 429
  ) {
    return 'Too many attempts. Please wait a few minutes and try again.'
  }
  if (code === 'session_not_found' || code === 'refresh_token_not_found') {
    return 'Your session has expired. Please sign in again.'
  }
  return GENERIC_ERROR
}

/** Maps Supabase/PostgREST errors to short, user-friendly messages. */
export function getDatabaseErrorMessage(error: unknown): string {
  const err = asErrorLike(error)
  const code = text(err.code)

  if (isNetworkError(err)) return NETWORK_ERROR
  if (code === '42501') return 'You do not have permission to perform that action.'
  if (code === '23514') return 'One of the values is not allowed. Check the field lengths and try again.'
  if (code === '23502') return 'A required value is missing.'
  if (code === 'PGRST301' || code === 'PGRST303' || err.status === 401) {
    return 'Your session has expired. Please sign in again.'
  }
  if (code === '42P01' || code === 'PGRST205') {
    return 'The database tables were not found. Apply the SQL migration in supabase/migrations first.'
  }
  return GENERIC_ERROR
}
