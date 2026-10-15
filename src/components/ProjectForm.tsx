import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { normalizeWebsiteUrl } from '../lib/url'
import { PROJECT_LIMITS, validateProjectForm } from '../lib/validation'
import {
  EMPTY_PROJECT_FORM,
  PROJECT_FORM_FIELDS,
  type ProjectFormErrors,
  type ProjectFormField,
  type ProjectFormValues,
  type ProjectInput,
} from '../types/project'
import { Alert } from './ui/Alert'
import { Button, ButtonLink } from './ui/Button'
import { TextAreaField } from './ui/TextAreaField'
import { TextField } from './ui/TextField'

type ProjectFormProps = {
  initialValues?: ProjectFormValues
  submitLabel: string
  /** Called with validated data. Resolve with an error message to display, or null on success. */
  onSubmit: (data: ProjectInput) => Promise<string | null>
  cancelTo: string
}

const fieldId = (field: ProjectFormField) => `project-${field.replace('_', '-')}`

export function ProjectForm({
  initialValues = EMPTY_PROJECT_FORM,
  submitLabel,
  onSubmit,
  cancelTo,
}: ProjectFormProps) {
  const [values, setValues] = useState<ProjectFormValues>(initialValues)
  const [errors, setErrors] = useState<ProjectFormErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // A ref guards against double submits that happen before React re-renders with `submitting`.
  const submittingRef = useRef(false)

  const urlPreview = useMemo(() => {
    const result = normalizeWebsiteUrl(values.website_url)
    return result.ok && result.url !== values.website_url.trim() ? result.url : null
  }, [values.website_url])

  function handleChange(field: ProjectFormField) {
    return (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      const next = event.target.value
      setValues((current) => ({ ...current, [field]: next }))
      setErrors((current) => (current[field] ? { ...current, [field]: undefined } : current))
    }
  }

  function handleBlur(field: ProjectFormField) {
    return () => {
      const result = validateProjectForm(values)
      const message = result.valid ? undefined : result.errors[field]
      setErrors((current) => ({ ...current, [field]: message }))
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submittingRef.current) return

    setSubmitError(null)
    const result = validateProjectForm(values)
    if (!result.valid) {
      setErrors(result.errors)
      const firstInvalid = PROJECT_FORM_FIELDS.find((field) => result.errors[field])
      if (firstInvalid) document.getElementById(fieldId(firstInvalid))?.focus()
      return
    }

    submittingRef.current = true
    setSubmitting(true)
    try {
      const error = await onSubmit(result.data)
      if (error) setSubmitError(error)
    } catch {
      setSubmitError('Something went wrong while saving. Please try again.')
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} noValidate aria-label="Project form" className="space-y-5">
      {submitError ? <Alert variant="error" title="Could not save the project">{submitError}</Alert> : null}

      <TextField
        id={fieldId('name')}
        label="Project name"
        required
        value={values.name}
        onChange={handleChange('name')}
        onBlur={handleBlur('name')}
        error={errors.name}
        maxLength={PROJECT_LIMITS.nameMax + 50}
        autoComplete="off"
        placeholder="e.g. Acme Plumbing — Main site"
        disabled={submitting}
      />

      <TextField
        id={fieldId('website_url')}
        label="Website URL"
        required
        type="text"
        inputMode="url"
        value={values.website_url}
        onChange={handleChange('website_url')}
        onBlur={handleBlur('website_url')}
        error={errors.website_url}
        autoComplete="off"
        autoCapitalize="none"
        spellCheck={false}
        placeholder="https://www.example.com"
        hint={
          urlPreview
            ? `Will be saved as ${urlPreview}`
            : 'The public address of the website. If you leave out the protocol, https:// is assumed.'
        }
        disabled={submitting}
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <TextField
          id={fieldId('business_name')}
          label="Business name"
          value={values.business_name}
          onChange={handleChange('business_name')}
          onBlur={handleBlur('business_name')}
          error={errors.business_name}
          autoComplete="off"
          disabled={submitting}
        />
        <TextField
          id={fieldId('location')}
          label="Primary location"
          value={values.location}
          onChange={handleChange('location')}
          onBlur={handleBlur('location')}
          error={errors.location}
          autoComplete="off"
          placeholder="City, region"
          disabled={submitting}
        />
      </div>

      <TextField
        id={fieldId('business_type')}
        label="Business type"
        value={values.business_type}
        onChange={handleChange('business_type')}
        onBlur={handleBlur('business_type')}
        error={errors.business_type}
        autoComplete="off"
        placeholder="e.g. Plumber, Dentist, Restaurant"
        disabled={submitting}
      />

      <TextAreaField
        id={fieldId('notes')}
        label="Notes"
        rows={5}
        value={values.notes}
        onChange={handleChange('notes')}
        onBlur={handleBlur('notes')}
        error={errors.notes}
        hint={`${values.notes.trim().length} / ${PROJECT_LIMITS.notesMax} characters`}
        disabled={submitting}
      />

      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Button type="submit" loading={submitting}>
          {submitLabel}
        </Button>
        <ButtonLink to={cancelTo} variant="ghost" aria-disabled={submitting || undefined}>
          Cancel
        </ButtonLink>
      </div>
    </form>
  )
}
