import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { Alert } from '../../components/ui/Alert'
import { Button } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { useAuth } from '../../hooks/useAuth'
import { validateEmail } from '../../lib/validation'

export function ForgotPasswordPage() {
  const { requestPasswordReset } = useAuth()
  const [email, setEmail] = useState('')
  const [emailError, setEmailError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [sent, setSent] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const error = validateEmail(email)
    setEmailError(error)
    setFormError(null)
    if (error) return

    setSubmitting(true)
    const result = await requestPasswordReset(email)
    setSubmitting(false)
    if (result.error) setFormError(result.error)
    else setSent(true)
  }

  return (
    <AuthLayout
      title="Reset your password"
      description="Enter your account email and we’ll send you a link to choose a new password."
      footer={
        <Link to="/sign-in" className="font-medium text-accent-ink hover:underline">
          Back to sign in
        </Link>
      }
    >
      {sent ? (
        // The same message is shown whether or not the address has an account, to avoid revealing registered emails.
        <Alert variant="success" title="Check your inbox">
          If an account exists for <strong className="break-all">{email.trim()}</strong>, a password reset link
          has been sent. The link may take a few minutes to arrive.
        </Alert>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
          {formError ? <Alert variant="error">{formError}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            error={emailError}
            disabled={submitting}
          />
          <Button type="submit" className="w-full" loading={submitting}>
            Send reset link
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
