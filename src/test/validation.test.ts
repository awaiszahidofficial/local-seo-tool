import { describe, expect, it } from 'vitest'
import { EMPTY_PROJECT_FORM, type ProjectFormValues } from '../types/project'
import {
  EMAIL_MAX_LENGTH,
  getPasswordRuleStatus,
  isValidEmail,
  PASSWORD_LIMITS,
  PROJECT_LIMITS,
  validateEmail,
  validatePassword,
  validateProjectForm,
  validateProjectName,
} from '../lib/validation'

function form(overrides: Partial<ProjectFormValues> = {}): ProjectFormValues {
  return { ...EMPTY_PROJECT_FORM, name: 'Acme Plumbing', website_url: 'acme.example.com', ...overrides }
}

describe('validateEmail', () => {
  it.each(['person@example.com', 'first.last@sub.example.co.uk', 'user+tag@example.org', "o'brien@example.com"])(
    'accepts %s',
    (email) => {
      expect(validateEmail(email)).toBeNull()
      expect(isValidEmail(email)).toBe(true)
    },
  )

  it('trims whitespace before validating', () => {
    expect(validateEmail('  person@example.com  ')).toBeNull()
  })

  it('requires a value', () => {
    expect(validateEmail('')).toBe('Email is required.')
    expect(validateEmail('   ')).toBe('Email is required.')
  })

  it.each([
    'plainaddress',
    '@example.com',
    'person@',
    'person@example',
    'person@@example.com',
    'person example@example.com',
    'person@exa mple.com',
    '.person@example.com',
    'person.@example.com',
    'per..son@example.com',
    'person@-example.com',
    'person@example..com',
  ])('rejects %s', (email) => {
    expect(validateEmail(email)).toBe('Enter a valid email address.')
    expect(isValidEmail(email)).toBe(false)
  })

  it('rejects addresses over the maximum length', () => {
    const email = `${'a'.repeat(60)}@${'b'.repeat(60)}.${'c'.repeat(60)}.${'d'.repeat(60)}.${'e'.repeat(20)}.com`
    expect(email.length).toBeGreaterThan(EMAIL_MAX_LENGTH)
    expect(validateEmail(email)).toBe(`Email must be ${EMAIL_MAX_LENGTH} characters or fewer.`)
  })

  it('rejects local parts longer than 64 characters', () => {
    expect(validateEmail(`${'a'.repeat(65)}@example.com`)).toBe('Enter a valid email address.')
  })
})

describe('validatePassword', () => {
  it('accepts passwords meeting every rule', () => {
    expect(validatePassword('Passw0rdOK')).toBeNull()
    expect(validatePassword('abcdefg1')).toBeNull()
    expect(validatePassword('correct horse battery 9')).toBeNull()
  })

  it('requires a value', () => {
    expect(validatePassword('')).toBe('Password is required.')
  })

  it('enforces the minimum length', () => {
    expect(validatePassword('abc123')).toBe(`Password must be at least ${PASSWORD_LIMITS.min} characters.`)
    expect(validatePassword('abcdef1')).not.toBeNull()
    expect(validatePassword('abcdefg1')).toBeNull()
  })

  it('requires a letter and a number', () => {
    expect(validatePassword('12345678')).toBe('Password must include at least one letter.')
    expect(validatePassword('abcdefgh')).toBe('Password must include at least one number.')
  })

  it('enforces the maximum length', () => {
    expect(validatePassword(`a1${'x'.repeat(PASSWORD_LIMITS.max - 2)}`)).toBeNull()
    expect(validatePassword(`a1${'x'.repeat(PASSWORD_LIMITS.max - 1)}`)).toBe(
      `Password must be ${PASSWORD_LIMITS.max} characters or fewer.`,
    )
  })

  it('does not trim passwords', () => {
    expect(validatePassword('        ')).toBe('Password must include at least one letter.')
    expect(validatePassword(' abcdef1')).toBeNull()
  })

  it('reports per-rule status consistently with validation', () => {
    const status = getPasswordRuleStatus('abc')
    const byId = Object.fromEntries(status.map(({ rule, met }) => [rule.id, met]))
    expect(byId).toEqual({ length: false, letter: true, number: false, maxLength: true })
    expect(getPasswordRuleStatus('Passw0rdOK').every(({ met }) => met)).toBe(true)
  })
})

describe('limits', () => {
  it('match the CHECK constraints in the SQL migration', () => {
    // If you change a limit, update supabase/migrations and these literals together.
    expect(PROJECT_LIMITS).toEqual({
      nameMin: 2,
      nameMax: 100,
      businessNameMax: 150,
      locationMax: 150,
      businessTypeMax: 100,
      notesMax: 2000,
    })
    expect(PASSWORD_LIMITS).toEqual({ min: 8, max: 72 })
    expect(EMAIL_MAX_LENGTH).toBe(254)
  })

  it('accepts exactly 100 characters and rejects 101 for a project name (literal boundary)', () => {
    expect(validateProjectName('a'.repeat(100))).toBeNull()
    expect(validateProjectName('a'.repeat(101))).toBe('Project name must be 100 characters or fewer.')
  })
})

describe('validateProjectName', () => {
  it('accepts a normal name and trims it for length checks', () => {
    expect(validateProjectName('Acme Plumbing')).toBeNull()
    expect(validateProjectName('  Ab  ')).toBeNull()
  })

  it('requires a name', () => {
    expect(validateProjectName('')).toBe('Project name is required.')
    expect(validateProjectName('     ')).toBe('Project name is required.')
  })

  it('enforces the minimum length after trimming', () => {
    expect(validateProjectName(' A ')).toBe(`Project name must be at least ${PROJECT_LIMITS.nameMin} characters.`)
  })

  it('enforces the maximum length', () => {
    expect(validateProjectName('a'.repeat(PROJECT_LIMITS.nameMax))).toBeNull()
    expect(validateProjectName('a'.repeat(PROJECT_LIMITS.nameMax + 1))).toBe(
      `Project name must be ${PROJECT_LIMITS.nameMax} characters or fewer.`,
    )
  })
})

describe('validateProjectForm', () => {
  it('returns trimmed, normalized data when valid', () => {
    const result = validateProjectForm(
      form({
        name: '  Acme Plumbing  ',
        website_url: '  www.Acme.com/services  ',
        business_name: '  Acme Plumbing LLC ',
        location: ' Austin, TX ',
        business_type: ' Plumber ',
        notes: '  First client.  ',
      }),
    )
    expect(result).toEqual({
      valid: true,
      errors: {},
      data: {
        name: 'Acme Plumbing',
        website_url: 'https://www.acme.com/services',
        business_name: 'Acme Plumbing LLC',
        location: 'Austin, TX',
        business_type: 'Plumber',
        notes: 'First client.',
      },
    })
  })

  it('converts empty and whitespace-only optional fields to null', () => {
    const result = validateProjectForm(form({ business_name: '', location: '   ', business_type: '\n', notes: '\t' }))
    expect(result.valid).toBe(true)
    if (result.valid) {
      expect(result.data.business_name).toBeNull()
      expect(result.data.location).toBeNull()
      expect(result.data.business_type).toBeNull()
      expect(result.data.notes).toBeNull()
    }
  })

  it('reports every invalid required field at once', () => {
    const result = validateProjectForm(EMPTY_PROJECT_FORM)
    expect(result.valid).toBe(false)
    expect(result.errors).toEqual({
      name: 'Project name is required.',
      website_url: 'Website URL is required.',
    })
  })

  it('reports an invalid URL and unsupported protocol', () => {
    expect(validateProjectForm(form({ website_url: 'not a url' })).errors.website_url).toBe(
      'Website URL cannot contain spaces.',
    )
    expect(validateProjectForm(form({ website_url: 'javascript:alert(1)' })).errors.website_url).toBe(
      'Only http:// and https:// website URLs are supported.',
    )
  })

  it.each([
    ['business_name', 'Business name', PROJECT_LIMITS.businessNameMax],
    ['location', 'Location', PROJECT_LIMITS.locationMax],
    ['business_type', 'Business type', PROJECT_LIMITS.businessTypeMax],
    ['notes', 'Notes', PROJECT_LIMITS.notesMax],
  ] as const)('enforces the %s length limit', (field, label, max) => {
    expect(validateProjectForm(form({ [field]: 'x'.repeat(max) })).valid).toBe(true)

    const tooLong = validateProjectForm(form({ [field]: 'x'.repeat(max + 1) }))
    expect(tooLong.valid).toBe(false)
    expect(tooLong.errors[field]).toBe(`${label} must be ${max} characters or fewer.`)
  })

  it('measures optional field length after trimming', () => {
    const padded = ` ${'x'.repeat(PROJECT_LIMITS.locationMax)} `
    expect(validateProjectForm(form({ location: padded })).valid).toBe(true)
  })
})
