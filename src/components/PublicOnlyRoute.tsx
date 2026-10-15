import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { safeRedirectPath } from '../lib/auth'
import { useAuth } from '../hooks/useAuth'
import { FullPageSpinner } from './FullPageSpinner'

function redirectTarget(state: unknown): string {
  if (typeof state === 'object' && state !== null && 'from' in state) {
    const from = (state as { from: unknown }).from
    if (typeof from === 'object' && from !== null && 'pathname' in from) {
      const { pathname, search } = from as { pathname?: unknown; search?: unknown }
      if (typeof pathname === 'string') {
        return safeRedirectPath(`${pathname}${typeof search === 'string' ? search : ''}`)
      }
    }
  }
  return '/'
}

/** Sign-in / sign-up style pages: signed-in users are redirected into the app. */
export function PublicOnlyRoute() {
  const { user, loading, isRecovery } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner />
  if (user && isRecovery) return <Navigate to="/reset-password" replace />
  if (user) return <Navigate to={redirectTarget(location.state)} replace />

  return <Outlet />
}
