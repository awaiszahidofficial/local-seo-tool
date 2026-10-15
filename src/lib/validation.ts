import type { ProjectFormErrors, ProjectFormResult, ProjectFormValues } from '../types/project'
import { normalizeWebsiteUrl } from './url'

export const EMAIL_MAX_LENGTH = 254

export const PASSWORD_LIMITS = { min: 8, max: 72 } as const

export const PROJECT_LIMITS = {
  nameMin: 2,
  nameMax: 100,
  businessNameMax: 150,
  locationMax: 150,
  businessTypeMax: 100,
  notesMax: 2000,
} as const

// ---------------------------------------------------------------------------
// Email
// ---------------------------------------------------------------------------

const EMAIL_PATTERN =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/

/** Returns an error message, or null when the email is acceptable. */
export function validateEmail(value: string): string | null {
  const email = value.trim()
  if (!email) return 'Email is required.'
  if (email.length > EMAIL_MAX_LENGTH) {
    return `Email must be ${EMAIL_MAX_LENGTH} characters or fewer.`
  }
  if (!EMAIL_PATTERN.test(email)) return 'Enter a valid email address.'

  const local = email.slice(0, email.lastIndexOf('@'))
  if (local.length > 64 || local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return 'Enter a valid email address.'
  }
  return null
}

export function isValidEmail(value: string): boolean {
  return validateEmail(value) === null
}

// ---------------------------------------------------------------------------
// Password
// ---------------------------------------------------------------------------

export type PasswordRule = {
  id: 'length' | 'maxLength' | 'letter' | 'number'
  label: string
  message: string
  test: (password: string) => boolean
}

/** Single source of truth for password requirements (sign-up form, reset form, validator). */
export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: 'length',
    label: `At least ${PASSWORD_LIMITS.min} characters`,
    message: `Password must be at least ${PASSWORD_LIMITS.min} characters.`,
    test: (password) => password.length >= PASSWORD_LIMITS.min,
  },
  {
    id: 'letter',
    label: 'Contains a letter',
    message: 'Password must include at least one letter.',
    test: (password) => /[A-Za-z]/.test(password),
  },
  {
    id: 'number',
    label: 'Contains a number',
    message: 'Password must include at least one number.',
    test: (password) => /\d/.test(password),
  },
  {
    id: 'maxLength',
    label: `No more than ${PASSWORD_LIMITS.max} characters`,
    message: `Password must be ${PASSWORD_LIMITS.max} characters or fewer.`,
    test: (password) => password.length <= PASSWORD_LIMITS.max,
  },
]

/** Passwords are intentionally NOT trimmed. Returns an error message, or null when valid. */
export function validatePassword(password: string): string | null {
  if (!password) return 'Password is required.'
  const failed = PASSWORD_RULES.find((rule) => !rule.test(password))
  return failed ? failed.message : null
}

export function getPasswordRuleStatus(password: string): { rule: PasswordRule; met: boolean }[] {
  return PASSWORD_RULES.map((rule) => ({ rule, met: rule.test(password) }))
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

export function validateProjectName(value: string): string | null {
  const name = value.trim()
  if (!name) return 'Project name is required.'
  if (name.length < PROJECT_LIMITS.nameMin) {
    return `Project name must be at least ${PROJECT_LIMITS.nameMin} characters.`
  }
  if (name.length > PROJECT_LIMITS.nameMax) {
    return `Project name must be ${PROJECT_LIMITS.nameMax} characters or fewer.`
  }
  return null
}

function readOptionalText(
  value: string,
  label: string,
  max: number,
): { value: string | null; error: string | null } {
  const trimmed = value.trim()
  if (!trimmed) return { value: null, error: null }
  if (trimmed.length > max) return { value: null, error: `${label} must be ${max} characters or fewer.` }
  return { value: trimmed, error: null }
}

/**
 * Validates the project form. On success, returns trimmed values with a normalized website URL
 * and empty optional fields converted to null. On failure, returns per-field error messages.
 */
export function validateProjectForm(values: ProjectFormValues): ProjectFormResult {
  const errors: ProjectFormErrors = {}

  const nameError = validateProjectName(values.name)
  if (nameError) errors.name = nameError

  const url = normalizeWebsiteUrl(values.website_url)
  if (!url.ok) errors.website_url = url.error

  const businessName = readOptionalText(values.business_name, 'Business name', PROJECT_LIMITS.businessNameMax)
  if (businessName.error) errors.business_name = businessName.error

  const location = readOptionalText(values.location, 'Location', PROJECT_LIMITS.locationMax)
  if (location.error) errors.location = location.error

  const businessType = readOptionalText(values.business_type, 'Business type', PROJECT_LIMITS.businessTypeMax)
  if (businessType.error) errors.business_type = businessType.error

  const notes = readOptionalText(values.notes, 'Notes', PROJECT_LIMITS.notesMax)
  if (notes.error) errors.notes = notes.error

  if (!url.ok || Object.keys(errors).length > 0) return { valid: false, errors }

  return {
    valid: true,
    errors: {},
    data: {
      name: values.name.trim(),
      website_url: url.url,
      business_name: businessName.value,
      location: location.value,
      business_type: businessType.value,
      notes: notes.value,
    },
  }
}
