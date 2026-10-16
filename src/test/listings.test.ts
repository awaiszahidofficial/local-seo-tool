import { describe, expect, it } from 'vitest'
import { EMPTY_LISTING_FORM, checkListing, referenceNap, summarizeListings, validateListingForm } from '../lib/listings'
import type { BusinessListingRow } from '../types/database'
import { makeProject } from './crawlFixtures'

const project = makeProject({ name: 'Acme', business_name: 'Acme Plumbing LLC', website_url: 'https://acme.example' })
const gbp = { business_name: 'Acme Plumbing', address: '12 Main St, Austin, TX 78701', phone: '(512) 555-0142', website_url: 'https://www.acme.example/' }

let n = 0
function listing(overrides: Partial<BusinessListingRow>): BusinessListingRow {
  n += 1
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    project_id: 'p',
    user_id: 'u',
    directory: 'Yelp',
    listing_url: null,
    status: 'live',
    name: null,
    address: null,
    phone: null,
    website: null,
    notes: null,
    last_checked: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  }
}

describe('referenceNap', () => {
  it('prefers the Business Profile, else the project', () => {
    expect(referenceNap(project, gbp)).toMatchObject({ name: 'Acme Plumbing', phone: '(512) 555-0142', source: 'gbp' })
    expect(referenceNap(project, null)).toMatchObject({ name: 'Acme Plumbing LLC', phone: null, website: 'https://acme.example', source: 'project' })
  })
})

describe('checkListing', () => {
  const reference = referenceNap(project, gbp)

  it('matches formatting differences: LLC, punctuation, phone format, www, St vs Street', () => {
    const check = checkListing(
      listing({ name: 'Acme Plumbing, LLC', phone: '512.555.0142', address: '12 Main Street, Austin TX 78701', website: 'http://acme.example/contact' }),
      reference,
    )
    expect(check.fields).toEqual({ name: 'match', address: 'match', phone: 'match', website: 'match' })
    expect(check.consistent).toBe(true)
  })

  it('flags real differences', () => {
    const check = checkListing(listing({ name: 'Acme Plumbing & Drains', phone: '512-555-9999', address: '400 Oak Ave, Austin, TX 78702', website: 'acme-plumbing.example' }), reference)
    expect(check.mismatches).toEqual(['name', 'address', 'phone', 'website'])
    expect(check.consistent).toBe(false)
  })

  it('does not judge empty fields or listings that are not live', () => {
    expect(checkListing(listing({ phone: '512 555 0142' }), reference).fields.name).toBe('not_entered')
    expect(checkListing(listing({ status: 'pending', phone: '000' }), reference).consistent).toBeNull()
    expect(checkListing(listing({ address: '1 X St' }), referenceNap(project, null)).fields.address).toBe('no_reference')
  })
})

describe('summarizeListings', () => {
  it('counts live, consistent, needing fixes and missing essential directories', () => {
    const reference = referenceNap(project, gbp)
    const summary = summarizeListings(
      [
        listing({ directory: 'Google Business Profile', phone: '5125550142' }),
        listing({ directory: 'yelp', phone: '512-555-9999' }),
        listing({ directory: 'Facebook', status: 'not_listed' }),
        listing({ directory: 'Bing Places', status: 'duplicate' }),
        listing({ directory: 'BBB', status: 'needs_update' }),
      ],
      reference,
    )
    expect(summary).toMatchObject({ total: 5, live: 3, consistent: 1, inconsistent: 2, duplicates: 1 })
    expect(summary.missingCore).toEqual(['Apple Business Connect', 'Facebook'])
  })
})

describe('validateListingForm', () => {
  it('requires a directory and cleans the rest', () => {
    expect(validateListingForm(EMPTY_LISTING_FORM).ok).toBe(false)
    const result = validateListingForm({ ...EMPTY_LISTING_FORM, directory: ' Yelp ', listing_url: 'yelp.com/biz/acme', phone: ' 512  555 0142 ' }, '2026-10-17')
    expect(result.ok && result.data).toMatchObject({ directory: 'Yelp', listing_url: 'https://yelp.com/biz/acme', phone: '512 555 0142', name: null })
  })

  it('rejects bad URLs and future dates', () => {
    const result = validateListingForm({ ...EMPTY_LISTING_FORM, directory: 'Yelp', listing_url: 'javascript:alert(1)', last_checked: '2027-01-01' }, '2026-10-17')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['last_checked', 'listing_url'])
  })
})
