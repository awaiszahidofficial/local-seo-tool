import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Alert } from '../components/ui/Alert'
import { ButtonLink } from '../components/ui/Button'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { finishGscConnect, takeReturnPath } from '../lib/searchConsole'

/** Google sends the user back here after the consent screen. */
export function SearchConsoleCallbackPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  // The one-time code and state may only be used once, even if React runs the effect twice.
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    const params = new URLSearchParams(searchParams)
    void finishGscConnect(params).then((result) => {
      if (result.data) {
        const email = result.data.email
        navigate(takeReturnPath(), {
          replace: true,
          state: { notice: `Google Search Console connected${email ? ` (${email})` : ''}.` },
        })
      } else {
        setError(result.error)
      }
    })
  }, [searchParams, navigate])

  return (
    <>
      <PageHeader title="Connecting Google Search Console" />
      {error ? (
        <Alert variant="error" title="Google was not connected">
          {error}
          <div className="mt-3">
            <ButtonLink to="/search-console" variant="secondary">
              Back to Search Console
            </ButtonLink>
          </div>
        </Alert>
      ) : (
        <LoadingState label="Finishing the Google sign-in…" />
      )}
    </>
  )
}
