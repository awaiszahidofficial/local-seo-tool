import { phoneKey } from '../../supabase/functions/_shared/phone.ts'
import type { BusinessListingInput, BusinessListingRow, GbpProfileRow, ListingStatus, ProjectRow } from '../types/database'
import { getDatabaseErrorMessage } from './errors'
import { streetKey } from './gbpAudit'
import { isUuid, type DataResult } from './projects'
import { supabase } from './supabase'
import { normalizeWebsiteUrl } from './url'

/**
 * Business Listings: storage plus a pure consistency check of each listing's name, address,
 * phone and website (NAP+W) against the business's reference details.
 */

export const LISTING_STATUS_LABELS: Record<ListingStatus, string> = {
  live: 'Live',
  needs_update: 'Needs update',
  pending: 'Submitted / pending',
  not_listed: 'Not listed',
  duplicate: 'Duplicate',
}

export type DirectoryTier = 'core' | 'major' | 'home_services' | 'other'

export type Directory = { name: string; tier: DirectoryTier; addUrl: string }

/** Directories worth having for most US local businesses, most important first. */
export const DIRECTORIES: readonly Directory[] = [
  { name: 'Google Business Profile', tier: 'core', addUrl: 'https://business.google.com/' },
  { name: 'Bing Places', tier: 'core', addUrl: 'https://www.bingplaces.com/' },
  { name: 'Apple Business Connect', tier: 'core', addUrl: 'https://businessconnect.apple.com/' },
  { name: 'Facebook', tier: 'core', addUrl: 'https://www.facebook.com/pages/create' },
  { name: 'Yelp', tier: 'core', addUrl: 'https://biz.yelp.com/' },
  { name: 'Better Business Bureau', tier: 'major', addUrl: 'https://www.bbb.org/get-listed' },
  { name: 'Nextdoor', tier: 'major', addUrl: 'https://business.nextdoor.com/' },
  { name: 'Yellow Pages', tier: 'major', addUrl: 'https://adsolutions.yp.com/listings/basic' },
  { name: 'Foursquare', tier: 'major', addUrl: 'https://foursquare.com/business/' },
  { name: 'Manta', tier: 'major', addUrl: 'https://www.manta.com/' },
  { name: 'Angi', tier: 'home_services', addUrl: 'https://www.angi.com/pro/' },
  { name: 'Thumbtack', tier: 'home_services', addUrl: 'https://www.thumbtack.com/pro' },
  { name: 'Houzz', tier: 'home_services', addUrl: 'https://pro.houzz.com/' },
  { name: 'Porch', tier: 'home_services', addUrl: 'https://pro.porch.com/' },
  { name: 'Chamber of Commerce', tier: 'other', addUrl: 'https://www.chamberofcommerce.com/' },
  { name: 'Hotfrog', tier: 'other', addUrl: 'https://www.hotfrog.com/' },
  { name: 'EZlocal', tier: 'other', addUrl: 'https://ezlocal.com/' },
  { name: 'Brownbook', tier: 'other', addUrl: 'https://www.brownbook.net/' },
]

export const TIER_LABELS: Record<DirectoryTier, string> = {
  core: 'Essential',
  major: 'Major directory',
  home_services: 'Home services',
  other: 'Other',
}

// ---- Reference details ----------------------------------------------------------------------

export type ReferenceNap = {
  name: string | null
  address: string | null
  phone: string | null
  website: string | null
  /** Where each value came from, for display. */
  source: 'gbp' | 'project'
}

/** The business's "correct" details: the Business Profile when entered, else the project. */
export function referenceNap(
  project: Pick<ProjectRow, 'name' | 'business_name' | 'website_url'>,
  gbp: Pick<GbpProfileRow, 'business_name' | 'address' | 'phone' | 'website_url'> | null,
): ReferenceNap {
  const fromGbp = gbp && (gbp.business_name || gbp.phone || gbp.address)
  return {
    name: gbp?.business_name ?? project.business_name ?? project.name,
    address: gbp?.address ?? null,
    phone: gbp?.phone ?? null,
    website: gbp?.website_url ?? project.website_url,
    source: fromGbp ? 'gbp' : 'project',
  }
}

// ---- Consistency ----------------------------------------------------------------------------

export type FieldCheck = 'match' | 'mismatch' | 'not_entered' | 'no_reference'
export type ListingFields = 'name' | 'address' | 'phone' | 'website'

export type ListingCheck = {
  listing: BusinessListingRow
  fields: Record<ListingFields, FieldCheck>
  /** True when every entered field matches; null when the listing is not live (nothing to check). */
  consistent: boolean | null
  mismatches: ListingFields[]
}

function compact(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\b(llc|inc|ltd|co|corp|company)\b\.?/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function host(value: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

/** Five-digit ZIP code, when present. */
function zip(value: string): string | null {
  return /\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/.exec(value)?.[1] ?? null
}

function compareField(field: ListingFields, value: string | null, reference: string | null): FieldCheck {
  if (!value?.trim()) return 'not_entered'
  if (!reference?.trim()) return 'no_reference'
  switch (field) {
    case 'name':
      return compact(value) === compact(reference) ? 'match' : 'mismatch'
    case 'phone':
      return phoneKey(value) === phoneKey(reference) ? 'match' : 'mismatch'
    case 'website':
      return host(value) !== null && host(value) === host(reference) ? 'match' : 'mismatch'
    case 'address': {
      const a = streetKey(value)
      const b = streetKey(reference)
      if (a && b && a !== b) return 'mismatch'
      const za = zip(value)
      const zb = zip(reference)
      if (za && zb && za !== zb) return 'mismatch'
      if (a && b) return 'match'
      return compact(value) === compact(reference) ? 'match' : 'mismatch'
    }
  }
}

const CHECKED_STATUSES: readonly ListingStatus[] = ['live', 'needs_update', 'duplicate']

export function checkListing(listing: BusinessListingRow, reference: ReferenceNap): ListingCheck {
  const fields: Record<ListingFields, FieldCheck> = {
    name: compareField('name', listing.name, reference.name),
    address: compareField('address', listing.address, reference.address),
    phone: compareField('phone', listing.phone, reference.phone),
    website: compareField('website', listing.website, reference.website),
  }
  const mismatches = (Object.keys(fields) as ListingFields[]).filter((field) => fields[field] === 'mismatch')
  const checked = CHECKED_STATUSES.includes(listing.status)
  return { listing, fields, consistent: checked ? mismatches.length === 0 : null, mismatches }
}

export type ListingsSummary = {
  total: number
  live: number
  consistent: number
  inconsistent: number
  duplicates: number
  pending: number
  /** Essential directories with no listing recorded (or recorded as "not listed"). */
  missingCore: string[]
  checks: ListingCheck[]
}

function sameDirectory(a: string, b: string): boolean {
  return compact(a) === compact(b)
}

export function summarizeListings(listings: readonly BusinessListingRow[], reference: ReferenceNap): ListingsSummary {
  const checks = listings.map((listing) => checkListing(listing, reference))
  const present = (name: string) =>
    listings.some((listing) => sameDirectory(listing.directory, name) && listing.status !== 'not_listed')
  return {
    total: listings.length,
    live: listings.filter((listing) => listing.status === 'live' || listing.status === 'needs_update').length,
    consistent: checks.filter((check) => check.consistent === true && check.listing.status === 'live').length,
    inconsistent: checks.filter((check) => check.consistent === false || check.listing.status === 'needs_update').length,
    duplicates: listings.filter((listing) => listing.status === 'duplicate').length,
    pending: listings.filter((listing) => listing.status === 'pending').length,
    missingCore: DIRECTORIES.filter((directory) => directory.tier === 'core' && !present(directory.name)).map((directory) => directory.name),
    checks,
  }
}

// ---- Form -----------------------------------------------------------------------------------

export type ListingFormValues = {
  directory: string
  listing_url: string
  status: ListingStatus
  name: string
  address: string
  phone: string
  website: string
  notes: string
  last_checked: string
}

export const EMPTY_LISTING_FORM: ListingFormValues = {
  directory: '',
  listing_url: '',
  status: 'live',
  name: '',
  address: '',
  phone: '',
  website: '',
  notes: '',
  last_checked: '',
}

export function listingToForm(listing: BusinessListingRow): ListingFormValues {
  return {
    directory: listing.directory,
    listing_url: listing.listing_url ?? '',
    status: listing.status,
    name: listing.name ?? '',
    address: listing.address ?? '',
    phone: listing.phone ?? '',
    website: listing.website ?? '',
    notes: listing.notes ?? '',
    last_checked: listing.last_checked ?? '',
  }
}

export type ListingFormErrors = Partial<Record<keyof ListingFormValues, string>>

export function validateListingForm(
  values: ListingFormValues,
  today: string = new Date().toISOString().slice(0, 10),
): { ok: true; data: BusinessListingInput } | { ok: false; errors: ListingFormErrors } {
  const errors: ListingFormErrors = {}
  const clean = (value: string, max: number, field: keyof ListingFormValues, label: string) => {
    const trimmed = value.replace(/\s+/g, ' ').trim()
    if (trimmed.length > max) errors[field] = `${label} must be ${max} characters or fewer.`
    return trimmed || null
  }
  const directory = clean(values.directory, 100, 'directory', 'Directory')
  if (!directory) errors.directory = 'Enter the directory or website name.'

  let listingUrl: string | null = null
  if (values.listing_url.trim()) {
    const result = normalizeWebsiteUrl(values.listing_url)
    if (result.ok) listingUrl = result.url
    else errors.listing_url = result.error
  }
  let lastChecked: string | null = null
  if (values.last_checked.trim()) {
    const date = values.last_checked.trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) errors.last_checked = 'Enter a valid date.'
    else if (date > today) errors.last_checked = 'The date cannot be in the future.'
    else lastChecked = date
  }

  const data: BusinessListingInput = {
    directory: directory ?? '',
    listing_url: listingUrl,
    status: values.status,
    name: clean(values.name, 200, 'name', 'Name'),
    address: clean(values.address, 300, 'address', 'Address'),
    phone: clean(values.phone, 40, 'phone', 'Phone'),
    website: clean(values.website, 2048, 'website', 'Website'),
    notes: (() => {
      const trimmed = values.notes.trim()
      if (trimmed.length > 1000) errors.notes = 'Notes must be 1,000 characters or fewer.'
      return trimmed || null
    })(),
    last_checked: lastChecked,
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors }
  return { ok: true, data }
}

// ---- Storage --------------------------------------------------------------------------------

const MISSING_TABLE =
  'Listings cannot be loaded yet. Run the 20261022000000_listings_recommendations_reports.sql migration in Supabase, then try again.'

function mapError(error: unknown): string {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {}
  if (record.code === '42P01' || record.code === 'PGRST205' || String(record.message ?? '').includes('business_listings')) return MISSING_TABLE
  return getDatabaseErrorMessage(error)
}

export async function listListings(projectId: string): Promise<DataResult<BusinessListingRow[]>> {
  if (!isUuid(projectId)) return { data: [], error: null }
  try {
    const { data, error } = await supabase
      .from('business_listings')
      .select('*')
      .eq('project_id', projectId)
      .order('directory', { ascending: true })
      .limit(500)
    if (error) return { data: null, error: mapError(error) }
    return { data: data ?? [], error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export async function saveListing(
  projectId: string,
  input: BusinessListingInput,
  id?: string,
): Promise<DataResult<BusinessListingRow>> {
  if (!isUuid(projectId) || (id !== undefined && !isUuid(id))) return { data: null, error: 'Listing not found.' }
  try {
    const query = id
      ? supabase.from('business_listings').update(input).eq('id', id).eq('project_id', projectId).select().maybeSingle()
      : supabase.from('business_listings').insert({ ...input, project_id: projectId }).select().maybeSingle()
    const { data, error } = await query
    if (error) return { data: null, error: mapError(error) }
    if (!data) return { data: null, error: 'Listing not found, or you do not have access to it.' }
    return { data, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

export async function deleteListing(id: string): Promise<DataResult<{ id: string }>> {
  if (!isUuid(id)) return { data: null, error: 'Listing not found.' }
  try {
    const { data, error } = await supabase.from('business_listings').delete().eq('id', id).select('id')
    if (error) return { data: null, error: mapError(error) }
    if (!data || data.length === 0) return { data: null, error: 'Listing not found, or you do not have access to it.' }
    return { data: { id }, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}
