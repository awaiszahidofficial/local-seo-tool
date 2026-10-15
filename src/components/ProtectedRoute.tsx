import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { FullPageSpinner } from './FullPageSpinner'

/** Renders nested routes only for signed-in users; everyone else is sent to sign-in. */
export function ProtectedRoute() {
  const { user, loading, isRecovery } = useAuth()
  const location = useLocation()

  if (loading) return <FullPageSpinner label="Checking your session…" />
  if (!user) return <Navigate to="/sign-in" replace state={{ from: location }} />
  // A recovery session may only be used to choose a new password.
  if (isRecovery) return <Navigate to="/reset-password" replace />

  return <Outlet />
}
