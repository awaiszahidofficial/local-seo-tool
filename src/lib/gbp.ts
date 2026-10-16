import type { GbpProfileInput, GbpProfileRow } from '../types/database'
import { getDatabaseErrorMessage } from './errors'
import { isUuid, type DataResult } from './projects'
import { parseList } from './serviceArea'
import { supabase } from './supabase'
import { normalizeWebsiteUrl } from './url'

/**
 * Google Business Profile details entered by the user: form values, validation and storage.
 * Every field is optional. An empty field is stored as NULL ("not entered"), and the audit
 * asks for it instead of failing it.
 */

export type TriState = '' | 'yes' | 'no'

export type GbpFormValues = {
  verified: TriState
  business_name: string
  primary_category: string
  additional_categories: string
  phone: string
  website_url: string
  address: string
  service_area_business: boolean
  gbp_service_areas: string
  has_hours: TriState
  has_special_hours: TriState
  description: string
  services: string
  products_count: string
  photos_count: string
  has_logo: TriState
  has_cover_photo: TriState
  review_count: string
  rating: string
  reviews_last_90_days: string
  reply_rate: string
  last_post_date: string
  attributes_count: string
  has_booking_link: TriState
}

export type GbpFormField = keyof GbpFormValues
export type GbpFormErrors = Partial<Record<GbpFormField, string>>

export const EMPTY_GBP_FORM: GbpFormValues = {
  verified: '',
  business_name: '',
  primary_category: '',
  additional_categories: '',
  phone: '',
  website_url: '',
  address: '',
  service_area_business: false,
  gbp_service_areas: '',
  has_hours: '',
  has_special_hours: '',
  description: '',
  services: '',
  products_count: '',
  photos_count: '',
  has_logo: '',
  has_cover_photo: '',
  review_count: '',
  rating: '',
  reviews_last_90_days: '',
  reply_rate: '',
  last_post_date: '',
  attributes_count: '',
  has_booking_link: '',
}

function tri(value: boolean | null): TriState {
  return value === null ? '' : value ? 'yes' : 'no'
}

function num(value: number | null): string {
  return value === null ? '' : String(value)
}

export function profileToFormValues(profile: GbpProfileRow | null): GbpFormValues {
  if (!profile) return { ...EMPTY_GBP_FORM }
  return {
    verified: tri(profile.verified),
    business_name: profile.business_name ?? '',
    primary_category: profile.primary_category ?? '',
    additional_categories: profile.additional_categories.join('\n'),
    phone: profile.phone ?? '',
    website_url: profile.website_url ?? '',
    address: profile.address ?? '',
    service_area_business: profile.service_area_business,
    gbp_service_areas: profile.gbp_service_areas.join('\n'),
    has_hours: tri(profile.has_hours),
    has_special_hours: tri(profile.has_special_hours),
    description: profile.description ?? '',
    services: profile.services.join('\n'),
    products_count: num(profile.products_count),
    photos_count: num(profile.photos_count),
    has_logo: tri(profile.has_logo),
    has_cover_photo: tri(profile.has_cover_photo),
    review_count: num(profile.review_count),
    rating: profile.rating === null ? '' : Number(profile.rating).toFixed(1),
    reviews_last_90_days: num(profile.reviews_last_90_days),
    reply_rate: num(profile.reply_rate),
    last_post_date: profile.last_post_date ?? '',
    attributes_count: num(profile.attributes_count),
    has_booking_link: tri(profile.has_booking_link),
  }
}

// ---- Validation -----------------------------------------------------------------------------

function text(value: string, max: number, label: string, errors: GbpFormErrors, field: GbpFormField): string | null {
  const trimmed = value.replace(/\s+/g, ' ').trim()
  if (!trimmed) return null
  if (trimmed.length > max) {
    errors[field] = `${label} must be ${max} characters or fewer.`
    return null
  }
  return trimmed
}

function integer(value: string, max: number, label: string, errors: GbpFormErrors, field: GbpFormField): number | null {
  const trimmed = value.replace(/[,\s]/g, '')
  if (!trimmed) return null
  if (!/^\d+$/.test(trimmed)) {
    errors[field] = `${label} must be a whole number.`
    return null
  }
  const parsed = Number(trimmed)
  if (parsed > max) {
    errors[field] = `${label} must be ${max.toLocaleString('en-US')} or less.`
    return null
  }
  return parsed
}

function bool(value: TriState): boolean | null {
  return value === '' ? null : value === 'yes'
}

function list(value: string, maxItems: number): string[] {
  return parseList(value).slice(0, maxItems)
}

/** `today` is injectable for tests (YYYY-MM-DD). */
export function validateGbpForm(
  values: GbpFormValues,
  today: string = new Date().toISOString().slice(0, 10),
): { ok: true; data: Omit<GbpProfileInput, 'project_id'> } | { ok: false; errors: GbpFormErrors } {
  const errors: GbpFormErrors = {}

  let website: string | null = null
  if (values.website_url.trim()) {
    const result = normalizeWebsiteUrl(values.website_url)
    if (result.ok) website = result.url
    else errors.website_url = result.error
  }

  let rating: number | null = null
  const ratingText = values.rating.trim().replace(',', '.')
  if (ratingText) {
    const parsed = Number(ratingText)
    if (!/^\d(\.\d+)?$/.test(ratingText) || parsed < 1 || parsed > 5) {
      errors.rating = 'Rating must be a number from 1.0 to 5.0.'
    } else {
      rating = Math.round(parsed * 10) / 10
    }
  }

  let lastPost: string | null = null
  if (values.last_post_date.trim()) {
    const date = values.last_post_date.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
      errors.last_post_date = 'Enter a valid date.'
    } else if (date > today) {
      errors.last_post_date = 'The last post date cannot be in the future.'
    } else {
      lastPost = date
    }
  }

  const replyRate = integer(values.reply_rate, 100, 'Reply rate', errors, 'reply_rate')
  const reviewCount = integer(values.review_count, 10_000_000, 'Review count', errors, 'review_count')
  const recentReviews = integer(values.reviews_last_90_days, 1_000_000, 'Reviews in the last 90 days', errors, 'reviews_last_90_days')
  if (reviewCount !== null && recentReviews !== null && recentReviews > reviewCount) {
    errors.reviews_last_90_days = 'Recent reviews cannot be more than the total number of reviews.'
  }

  const data = {
    verified: bool(values.verified),
    business_name: text(values.business_name, 200, 'Business name', errors, 'business_name'),
    primary_category: text(values.primary_category, 120, 'Primary category', errors, 'primary_category'),
    additional_categories: list(values.additional_categories, 20),
    phone: text(values.phone, 40, 'Phone', errors, 'phone'),
    website_url: website,
    address: text(values.address, 300, 'Address', errors, 'address'),
    service_area_business: values.service_area_business,
    gbp_service_areas: list(values.gbp_service_areas, 40),
    has_hours: bool(values.has_hours),
    has_special_hours: bool(values.has_special_hours),
    description: (() => {
      const trimmed = values.description.trim()
      if (!trimmed) return null
      if (trimmed.length > 1000) {
        errors.description = 'Description must be 1,000 characters or fewer (Google allows 750).'
        return null
      }
      return trimmed
    })(),
    services: list(values.services, 200),
    products_count: integer(values.products_count, 100_000, 'Products', errors, 'products_count'),
    photos_count: integer(values.photos_count, 1_000_000, 'Photos', errors, 'photos_count'),
    has_logo: bool(values.has_logo),
    has_cover_photo: bool(values.has_cover_photo),
    review_count: reviewCount,
    rating,
    reviews_last_90_days: recentReviews,
    reply_rate: replyRate,
    last_post_date: lastPost,
    attributes_count: integer(values.attributes_count, 1000, 'Attributes', errors, 'attributes_count'),
    has_booking_link: bool(values.has_booking_link),
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, data }
}

// ---- Storage --------------------------------------------------------------------------------

const MISSING_TABLE =
  'Google Business Profile data cannot be saved yet. Run the 20261020000000_gbp_profiles.sql migration in Supabase, then try again.'

function isMissingTable(error: unknown): boolean {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {}
  const code = typeof record.code === 'string' ? record.code : ''
  const message = typeof record.message === 'string' ? record.message : ''
  return code === '42P01' || code === 'PGRST205' || /gbp_profiles/.test(message)
}

/** The saved profile for a project, or `data: null, error: null` when none was entered yet. */
export async function getGbpProfile(projectId: string): Promise<DataResult<GbpProfileRow | null>> {
  if (!isUuid(projectId)) return { data: null, error: null }
  try {
    const { data, error } = await supabase.from('gbp_profiles').select('*').eq('project_id', projectId).maybeSingle()
    if (error) return { data: null, error: isMissingTable(error) ? MISSING_TABLE : getDatabaseErrorMessage(error) }
    return { data, error: null }
  } catch (error) {
    return { data: null, error: getDatabaseErrorMessage(error) }
  }
}

/** Creates or replaces the profile for a project (RLS checks that the project is the caller's). */
export async function saveGbpProfile(
  projectId: string,
  input: Omit<GbpProfileInput, 'project_id'>,
): Promise<DataResult<GbpProfileRow>> {
  if (!isUuid(projectId)) return { data: null, error: 'Choose a project first.' }
  try {
    const { data, error } = await supabase
      .from('gbp_profiles')
      .upsert({ ...input, project_id: projectId }, { onConflict: 'project_id' })
      .select()
      .single()
    if (error) return { data: null, error: isMissingTable(error) ? MISSING_TABLE : getDatabaseErrorMessage(error) }
    return { data, error: null }
  } catch (error) {
    return { data: null, error: getDatabaseErrorMessage(error) }
  }
}
