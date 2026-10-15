import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AuthLayout } from '../../components/AuthLayout'
import { FullPageSpinner } from '../../components/FullPageSpinner'
import { PasswordRequirements } from '../../components/PasswordRequirements'
import { Alert } from '../../components/ui/Alert'
import { Button, ButtonLink } from '../../components/ui/Button'
import { TextField } from '../../components/ui/TextField'
import { useAuth } from '../../hooks/useAuth'
import { validatePassword } from '../../lib/validation'

type FieldErrors = { password?: string; confirm?: string }

export function ResetPasswordPage() {
  const { user, loading, isRecovery, updatePassword, signOut } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [errors, setErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)

  if (loading) return <FullPageSpinner label="Verifying your reset link…" />

  // Without a session the link was never opened, has expired, or was already used.
  if (!user) {
    return (
      <AuthLayout title="Reset link not valid">
        <Alert variant="error" title="This link is invalid or has expired">
          Password reset links can only be used once and expire after a short time. Request a new link to
          continue.
        </Alert>
        <ButtonLink to="/forgot-password" className="mt-5 w-full">
          Request a new link
        </ButtonLink>
      </AuthLayout>
    )
  }

  if (done) {
    return (
      <AuthLayout title="Password updated">
        <Alert variant="success">Your password has been changed. You are signed in.</Alert>
        <ButtonLink to="/" className="mt-5 w-full">
          Continue to the app
        </ButtonLink>
      </AuthLayout>
    )
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const nextErrors: FieldErrors = {}
    const passwordError = validatePassword(password)
    if (passwordError) nextErrors.password = passwordError
    if (!confirm) nextErrors.confirm = 'Confirm your new password.'
    else if (confirm !== password) nextErrors.confirm = 'Passwords do not match.'
    setErrors(nextErrors)
    setFormError(null)
    if (Object.keys(nextErrors).length > 0) return

    setSubmitting(true)
    const result = await updatePassword(password)
    setSubmitting(false)
    if (result.error) setFormError(result.error)
    else setDone(true)
  }

  async function handleCancel() {
    await signOut()
    navigate('/sign-in', { replace: true })
  }

  return (
    <AuthLayout
      title="Choose a new password"
      description={
        isRecovery
          ? 'Set a new password to finish recovering your account.'
          : 'Enter a new password for your account.'
      }
      footer={
        isRecovery ? (
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="font-medium text-indigo-700 hover:underline"
          >
            Cancel and sign out
          </button>
        ) : (
          <Link to="/" className="font-medium text-indigo-700 hover:underline">
            Back to the app
          </Link>
        )
      }
    >
      <form onSubmit={(event) => void handleSubmit(event)} noValidate className="space-y-5">
        {formError ? <Alert variant="error">{formError}</Alert> : null}
        <div>
          <TextField
            label="New password"
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
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          error={errors.confirm}
          disabled={submitting}
        />
        <Button type="submit" className="w-full" loading={submitting}>
          Update password
        </Button>
      </form>
    </AuthLayout>
  )
}
