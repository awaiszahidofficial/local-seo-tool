import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

function readNotice(state: unknown): string | null {
  if (typeof state === 'object' && state !== null && 'notice' in state) {
    const notice = (state as { notice: unknown }).notice
    return typeof notice === 'string' && notice ? notice : null
  }
  return null
}

/**
 * One-time success message passed through router state (e.g. after creating a project).
 * The message is kept in component state and removed from history state so it does not
 * reappear on refresh.
 */
export function useFlashNotice() {
  const location = useLocation()
  const navigate = useNavigate()
  const [notice, setNotice] = useState<string | null>(() => readNotice(location.state))

  useEffect(() => {
    if (readNotice(location.state)) {
      navigate(`${location.pathname}${location.search}`, { replace: true, state: null })
    }
  }, [location.state, location.pathname, location.search, navigate])

  return [notice, setNotice] as const
}
