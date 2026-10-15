import { useState, type FormEvent } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { useAuth } from '../../hooks/useAuth'
import { validateEmail } from '../../lib/validation'

type FieldErrors = { email?: string; password?: string }

export function SignInPage() {
  const { signIn } = useAuth()
  const location = useLocation()
  const notice =
    typeof location.state === 'object' && location.state !== null && 'notice' in location.state
      ? String((location.state as { notice: unknown }).notice)
      : null

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FieldErrors = {}
    const emailError = validateEmail(email)
    if (emailError) nextErrors.email = emailError
    if (!password) nextErrors.password = 'Password is required.'
    setErrors(nextErrors)
    setFormError(null)
    if (nextErrors.email || nextErrors.password) return

    setSubmitting(true)
    const { error } = await signIn(email, password)
    // On success the public-only route redirects into the app, so only failures need handling here.
    if (error) {
      setFormError(error)
      setSubmitting(false)
    }
  }

  return (
    <AuthLayout
      title="Sign in"
      description="Welcome back. Sign in to manage your local SEO projects."
      footer={
        <>
          New to Local SEO Workbench?{' '}
          <Link to="/sign-up" className="font-medium text-indigo-700 hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        {notice ? <Alert variant="success">{notice}</Alert> : null}
        {formError ? <Alert variant="error">{formError}</Alert> : null}

        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          disabled={submitting}
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          disabled={submitting}
        />

        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-indigo-700 hover:underline">
            Forgot your password?
          </Link>
        </div>

        <Button type="submit" className="w-full" loading={submitting}>
          Sign in
        </Button>
      </form>
    </AuthLayout>
  )
}
