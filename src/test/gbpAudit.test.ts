import { describe, expect, it } from 'vitest'
import { auditGbp, streetKey, type GbpProfileData, type GbpSitePage } from '../lib/gbpAudit'
import { EMPTY_GBP_FORM, profileToFormValues, validateGbpForm } from '../lib/gbp'
import { makeCrawlPage, makeProject } from './crawlFixtures'

const TODAY = '2026-10-16'

const project = makeProject({
  name: 'Acme',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
  website_url: 'https://www.acme.example',
  services: ['Drain cleaning', 'Water heater repair'],
  service_areas: ['Austin, TX', 'Round Rock, TX'],
})

const fullProfile: GbpProfileData = {
  verified: true,
  business_name: 'Acme Plumbing',
  primary_category: 'Plumber',
  additional_categories: ['Drainage service', 'Water heater installation service'],
  phone: '(512) 555-0142',
  website_url: 'https://acme.example/',
  address: '12 Main St, Austin, TX 78701',
  service_area_business: false,
  gbp_service_areas: [],
  has_hours: true,
  has_special_hours: true,
  description:
    'Acme Plumbing is a family-run plumber serving Austin and Round Rock. We handle drain cleaning, water heater repair and replacement, leak detection and emergency plumbing with upfront prices, licensed technicians and a one-year guarantee on all work. Same-day appointments available.',
  services: ['Drain cleaning', 'Water heater repair', 'Leak detection', 'Repiping', 'Toilet repair'],
  products_count: 3,
  photos_count: 42,
  has_logo: true,
  has_cover_photo: true,
  review_count: 120,
  rating: 4.8,
  reviews_last_90_days: 9,
  reply_rate: 95,
  last_post_date: '2026-10-01',
  attributes_count: 8,
  has_booking_link: true,
}

const blankProfile: GbpProfileData = {
  ...fullProfile,
  verified: null,
  business_name: null,
  primary_category: null,
  additional_categories: [],
  phone: null,
  website_url: null,
  address: null,
  has_hours: null,
  has_special_hours: null,
  description: null,
  services: [],
  products_count: null,
  photos_count: null,
  has_logo: null,
  has_cover_photo: null,
  review_count: null,
  rating: null,
  reviews_last_90_days: null,
  reply_rate: null,
  last_post_date: null,
  attributes_count: null,
  has_booking_link: null,
}

const site: GbpSitePage[] = [
  makeCrawlPage({
    url: 'https://acme.example/',
    phones: ['512-555-0142'],
    schema_local: {
      types: ['Plumber'],
      name: 'Acme Plumbing',
      telephone: '+1 512 555 0142',
      address: '12 Main Street, Austin, TX, 78701',
      has_geo: false,
      has_hours: false,
      same_as_count: 0,
      has_rating: false,
      url: null,
    },
  }),
]

function status(audit: ReturnType<typeof auditGbp>, id: string) {
  return audit.checks.find((check) => check.id === id)?.status
}

describe('auditGbp', () => {
  it('scores a complete, consistent profile at 100 with nothing to fix', () => {
    const audit = auditGbp(project, fullProfile, site, TODAY)
    expect(audit.topFixes).toEqual([])
    expect(audit.score).toBe(100)
    expect(audit.missing).toEqual([])
    expect(audit.crawlUsed).toBe(true)
    expect(status(audit, 'site_phone')).toBe('pass')
    expect(status(audit, 'site_address')).toBe('pass')
    expect(status(audit, 'site_name')).toBe('pass')
  })

  it('asks for every detail on an empty profile instead of failing it', () => {
    const audit = auditGbp(project, blankProfile, null, TODAY)
    expect(audit.counts.fail).toBe(0)
    expect(audit.missing).toEqual(expect.arrayContaining(['Profile is verified', 'Primary category', 'Number of reviews']))
    expect(status(audit, 'site_phone')).toBe('info')
  })

  it('flags keyword stuffing in the business name', () => {
    const audit = auditGbp(project, { ...fullProfile, business_name: 'Acme Plumbing Austin' }, site, TODAY)
    expect(status(audit, 'name')).toBe('warn')
    expect(audit.checks.find((check) => check.id === 'name')?.detail).toMatch(/keyword stuffing/)
    const service = auditGbp(project, { ...fullProfile, business_name: 'Acme Plumbing - Best Plumber' }, site, TODAY)
    expect(status(service, 'name')).toBe('warn') // differs from the real name
    expect(status(auditGbp(project, fullProfile, site, TODAY), 'name')).toBe('pass')
  })

  it('grades reviews, rating, recency and replies', () => {
    const audit = auditGbp(
      project,
      { ...fullProfile, review_count: 6, rating: 4.2, reviews_last_90_days: 0, reply_rate: 60 },
      site,
      TODAY,
    )
    expect(status(audit, 'review_count')).toBe('fail')
    expect(status(audit, 'rating')).toBe('warn')
    expect(status(audit, 'review_recency')).toBe('fail')
    expect(status(audit, 'reply_rate')).toBe('warn')
    expect(audit.topFixes[0]?.status).toBe('fail')
    expect(audit.topFixes[0]?.weight).toBe(3)
  })

  it('checks description length, location, services and forbidden content', () => {
    const long = auditGbp(project, { ...fullProfile, description: 'x'.repeat(800) }, site, TODAY)
    expect(status(long, 'description')).toBe('fail')
    expect(status(long, 'description_city')).toBe('warn')
    expect(status(long, 'description_service')).toBe('warn')
    const withLink = auditGbp(project, { ...fullProfile, description: `${fullProfile.description} Visit www.acme.example or call 512-555-0142.` }, site, TODAY)
    expect(status(withLink, 'description_rules')).toBe('warn')
  })

  it('grades post recency against today', () => {
    expect(status(auditGbp(project, { ...fullProfile, last_post_date: '2026-08-01' }, site, TODAY), 'posts')).toBe('warn')
    expect(status(auditGbp(project, { ...fullProfile, last_post_date: '2026-01-01' }, site, TODAY), 'posts')).toBe('fail')
  })

  it('compares phone, address and website with the site', () => {
    const audit = auditGbp(
      project,
      { ...fullProfile, phone: '(512) 555-9999', address: '400 Oak Ave, Austin, TX', website_url: 'https://acme-directory.example/acme' },
      site,
      TODAY,
    )
    expect(status(audit, 'site_phone')).toBe('fail')
    expect(status(audit, 'site_address')).toBe('fail')
    expect(status(audit, 'website')).toBe('fail')
  })

  it('lists project services missing from the profile', () => {
    const audit = auditGbp(project, { ...fullProfile, services: ['Drain cleaning', 'Repiping', 'Toilet repair', 'Gas lines', 'Sewer'] }, site, TODAY)
    expect(status(audit, 'services')).toBe('warn')
    expect(audit.checks.find((check) => check.id === 'services')?.detail).toContain('Water heater repair')
  })

  it('handles service-area businesses: areas instead of address, and coverage of project areas', () => {
    const audit = auditGbp(
      project,
      { ...fullProfile, service_area_business: true, address: null, gbp_service_areas: ['Austin, TX'] },
      site,
      TODAY,
    )
    expect(status(audit, 'location')).toBe('pass')
    expect(status(audit, 'area_match')).toBe('warn')
    expect(audit.checks.find((check) => check.id === 'area_match')?.detail).toContain('Round Rock')
    expect(audit.checks.some((check) => check.id === 'site_address')).toBe(false)
    const none = auditGbp(project, { ...fullProfile, service_area_business: true, gbp_service_areas: [] }, site, TODAY)
    expect(status(none, 'location')).toBe('fail')
  })

  it('warns when the primary category does not match the business type', () => {
    expect(status(auditGbp(project, { ...fullProfile, primary_category: 'Electrician' }, site, TODAY), 'primary_category')).toBe('warn')
  })
})

describe('streetKey', () => {
  it('reduces addresses to number and street name', () => {
    expect(streetKey('12 Main St, Austin')).toBe('12 main')
    expect(streetKey('Suite 4, 12 N. Main Street')).toBe('12 main')
    expect(streetKey('No number here')).toBeNull()
  })
})

describe('GBP form', () => {
  it('turns an empty form into all "not entered" values', () => {
    const result = validateGbpForm(EMPTY_GBP_FORM, TODAY)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.verified).toBeNull()
      expect(result.data.review_count).toBeNull()
      expect(result.data.services).toEqual([])
    }
  })

  it('parses numbers, lists, tri-states, rating and URL', () => {
    const result = validateGbpForm(
      {
        ...EMPTY_GBP_FORM,
        verified: 'yes',
        has_logo: 'no',
        review_count: '1,204',
        rating: '4,7',
        services: 'Drain cleaning\nLeak detection\ndrain cleaning',
        website_url: 'acme.example',
        last_post_date: '2026-10-01',
      },
      TODAY,
    )
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data).toMatchObject({
        verified: true,
        has_logo: false,
        review_count: 1204,
        rating: 4.7,
        services: ['Drain cleaning', 'Leak detection'],
        website_url: 'https://acme.example',
        last_post_date: '2026-10-01',
      })
    }
  })

  it('reports invalid values per field', () => {
    const result = validateGbpForm(
      {
        ...EMPTY_GBP_FORM,
        rating: '6',
        reply_rate: '120',
        photos_count: 'lots',
        last_post_date: '2026-12-01',
        review_count: '5',
        reviews_last_90_days: '9',
        website_url: 'javascript:alert(1)',
      },
      TODAY,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(Object.keys(result.errors).sort()).toEqual(
        ['last_post_date', 'photos_count', 'rating', 'reply_rate', 'reviews_last_90_days', 'website_url'].sort(),
      )
    }
  })

  it('round-trips a saved profile into form values', () => {
    const values = profileToFormValues({ ...fullProfile, project_id: 'p', user_id: 'u', created_at: '', updated_at: '' })
    expect(values.verified).toBe('yes')
    expect(values.rating).toBe('4.8')
    expect(values.services.split('\n')).toHaveLength(5)
    const again = validateGbpForm(values, TODAY)
    expect(again.ok && again.data.services).toEqual(fullProfile.services)
  })
})
