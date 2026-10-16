import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { PasswordRequirements } from '../../components/PasswordRequirements'
import { Alert } from '../../components/ui/Alert'
import { Button, ButtonLink } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { useAuth } from '../../hooks/useAuth'
import { validateEmail, validatePassword } from '../../lib/validation'

type FieldErrors = { email?: string; password?: string; confirm?: string }

export function SignUpPage() {
  const { signUp } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [confirmationSentTo, setConfirmationSentTo] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FieldErrors = {}
    const emailError = validateEmail(email)
    if (emailError) nextErrors.email = emailError
    const passwordError = validatePassword(password)
    if (passwordError) nextErrors.password = passwordError
    if (!confirm) nextErrors.confirm = 'Confirm your password.'
    else if (confirm !== password) nextErrors.confirm = 'Passwords do not match.'
    setErrors(nextErrors)
    setFormError(null)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    const result = await signUp(email, password)
    setSubmitting(false)
    if (result.error) {
      setFormError(result.error)
    } else if (result.needsEmailConfirmation) {
      setConfirmationSentTo(email.trim())
    }
    // Otherwise a session already exists and the public-only route redirects into the app.
  }

  if (confirmationSentTo) {
    return (
      <AuthLayout title="Check your email">
        <Alert variant="success" title="Almost there">
          If this address can be registered, a confirmation link is on its way to{' '}
          <strong className="break-all">{confirmationSentTo}</strong>. Open it to activate your account, then
          sign in.
        </Alert>
        <ButtonLink to="/sign-in" variant="secondary" className="mt-5 w-full">
          Go to sign in
        </ButtonLink>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout
      title="Create your account"
      description="Start organizing your local SEO projects in one workspace."
      footer={
        <>
          Already have an account?{' '}
          <Link to="/sign-in" className="font-medium text-accent-ink hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
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
        <div>
          <TextField
            label="Password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
            disabled={submitting}
          />
          <div className="mt-3">
            <PasswordRequirements password={password} />
          </div>
        </div>
        <TextField
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
          disabled={submitting}
        />

        <Button type="submit" className="w-full" loading={submitting}>
          Create account
        </Button>
      </form>
    </AuthLayout>
  )
}
