import { ButtonLink } from '../components/ui/Button'

export function NotFoundPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 text-center">
      <p className="text-sm font-semibold text-accent-ink">404</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-ink">Page not found</h1>
      <p className="mt-2 max-w-md text-sm text-ink-2">
        The page you are looking for does not exist or has been moved.
      </p>
      <ButtonLink to="/" className="mt-6">
        Go to the app
      </ButtonLink>
    </main>
  )
}
