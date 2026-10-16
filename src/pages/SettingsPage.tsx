import { Alert } from '../components/ui/Alert'
import { Card, CardHeader } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { formatDate } from '../lib/format'

export function SettingsPage() {
  const { user } = useAuth()

  return (
    <>
      <PageHeader title="Settings" description="Information about your account." />

      <Card as="section" aria-labelledby="account-details" className="max-w-3xl">
        <CardHeader id="account-details" title="Account" />
        <dl className="divide-y divide-line-soft">
          <div className="px-5 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-ink-2">Email</dt>
            <dd className="mt-1 text-sm break-all text-ink sm:col-span-2 sm:mt-0">{user?.email ?? '—'}</dd>
          </div>
          <div className="px-5 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
            <dt className="text-sm font-medium text-ink-2">Member since</dt>
            <dd className="mt-1 text-sm text-ink sm:col-span-2 sm:mt-0">{formatDate(user?.created_at)}</dd>
          </div>
        </dl>
      </Card>

      <Alert variant="info" className="mt-6 max-w-3xl" title="More settings are planned">
        Profile editing, team access, and integration settings are not available in this phase. Use the Sign out
        button in the sidebar to end your session.
      </Alert>
    </>
  )
}
