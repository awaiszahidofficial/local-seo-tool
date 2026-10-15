import type { ProjectRow } from './database'

/** Raw string values held by the project form (all inputs are strings). */
export type ProjectFormValues = {
  name: string
  website_url: string
  business_name: string
  location: string
  business_type: string
  notes: string
}

export type ProjectFormField = keyof ProjectFormValues

export type ProjectFormErrors = Partial<Record<ProjectFormField, string>>

/** Validated, trimmed, normalized payload ready to be saved. Empty optionals are null. */
export type ProjectInput = {
  name: string
  website_url: string
  business_name: string | null
  location: string | null
  business_type: string | null
  notes: string | null
}

export type ProjectFormResult =
  | { valid: true; data: ProjectInput; errors: Record<string, never> }
  | { valid: false; errors: ProjectFormErrors }

/** Display/focus order of the form fields. */
export const PROJECT_FORM_FIELDS: readonly ProjectFormField[] = [
  'name',
  'website_url',
  'business_name',
  'location',
  'business_type',
  'notes',
]

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: '',
  website_url: '',
  business_name: '',
  location: '',
  business_type: '',
  notes: '',
}

export function projectToFormValues(project: ProjectRow): ProjectFormValues {
  return {
    name: project.name,
    website_url: project.website_url,
    business_name: project.business_name ?? '',
    location: project.location ?? '',
    business_type: project.business_type ?? '',
    notes: project.notes ?? '',
  }
}
