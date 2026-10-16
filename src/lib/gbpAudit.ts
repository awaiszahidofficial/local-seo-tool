import { phoneKey } from '../../supabase/functions/_shared/phone.ts'
import type { CrawlPageRow, GbpProfileRow, ProjectRow } from '../types/database'
import { buildContext, countTerms } from './localAudit'
import { buildAreaMatcher, buildServiceMatcher, effectiveServices } from './serviceArea'

/**
 * Google Business Profile audit engine. Pure functions over the profile details the user entered,
 * the project, and (optionally) the latest crawl for website consistency checks.
 *
 * Status meanings:
 *   pass / warn / fail — scored
 *   missing            — the user has not entered that detail yet (not scored; listed to fill in)
 *   info               — could not be checked (for example no crawl yet); not scored
 */

export type GbpStatus = 'pass' | 'warn' | 'fail' | 'missing' | 'info'

export type GbpGroup = 'basics' | 'categories' | 'contact' | 'description' | 'photos' | 'reviews' | 'posts' | 'website'

export const GBP_GROUP_LABELS: Record<GbpGroup, string> = {
  basics: 'Profile basics',
  categories: 'Categories and services',
  contact: 'Contact details and location',
  description: 'Business description',
  photos: 'Photos',
  reviews: 'Reviews',
  posts: 'Posts and activity',
  website: 'Matches the website',
}

const GROUP_ORDER: readonly GbpGroup[] = ['basics', 'categories', 'contact', 'description', 'photos', 'reviews', 'posts', 'website']

export type GbpCheck = {
  id: string
  group: GbpGroup
  label: string
  status: GbpStatus
  detail: string
  /** Importance used for the score and for ranking fixes (1–3). */
  weight: number
}

export type GbpAudit = {
  checks: GbpCheck[]
  groups: { group: GbpGroup; label: string; checks: GbpCheck[] }[]
  /** 0–100 over the checks that could be scored; null when nothing could be scored yet. */
  score: number | null
  counts: Record<GbpStatus, number>
  /** Failures, then warnings, most important first. */
  topFixes: GbpCheck[]
  /** Labels of details still to fill in. */
  missing: string[]
  crawlUsed: boolean
}

export type GbpAuditProject = Pick<ProjectRow, 'name' | 'business_name' | 'location' | 'business_type' | 'website_url'> & {
  service_areas?: string[] | null
  services?: string[] | null
}

export type GbpProfileData = Omit<GbpProfileRow, 'project_id' | 'user_id' | 'created_at' | 'updated_at'>

export type GbpSitePage = Pick<CrawlPageRow, 'url' | 'status_code' | 'error' | 'phones' | 'schema_local' | 'address_text'>

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

function compact(value: string | null | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

function bareHost(url: string | null | undefined): string | null {
  if (!url) return null
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return null
  }
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`
}

function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
}

/** Street number plus the first word of the street name, e.g. "12 main"; null when not found. */
export function streetKey(address: string | null | undefined): string | null {
  if (!address) return null
  const match = /(\d{1,6})\s+(?:[nsew]\.?\s+|north\s+|south\s+|east\s+|west\s+)?([\p{L}\d]+)/iu.exec(address)
  return match ? `${match[1]} ${match[2]?.toLowerCase()}` : null
}

const URL_IN_TEXT = /(https?:\/\/|www\.)\S+|\b[a-z0-9-]+\.(com|net|org|co|io|us|uk|ca|au)\b/i
const PHONE_IN_TEXT = /(?<!\d)(?:\+?\d[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?!\d)/

type Partial3 = Pick<GbpCheck, 'status' | 'detail'>

function make(id: string, group: GbpGroup, label: string, weight: number, result: Partial3): GbpCheck {
  return { id, group, label, weight, ...result }
}

// ---------------------------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------------------------

export function auditGbp(
  project: GbpAuditProject,
  profile: GbpProfileData,
  sitePages: readonly GbpSitePage[] | null,
  today: string = new Date().toISOString().slice(0, 10),
): GbpAudit {
  const ctx = buildContext(project)
  const checks: GbpCheck[] = []
  const add = (id: string, group: GbpGroup, label: string, weight: number, result: Partial3) =>
    checks.push(make(id, group, label, weight, result))
  const missing = (what: string): Partial3 => ({ status: 'missing', detail: `Enter ${what} to run this check.` })

  // ---- Basics -------------------------------------------------------------------------------
  add('verified', 'basics', 'Profile is verified', 3,
    profile.verified === null
      ? missing('whether the profile is verified')
      : profile.verified
        ? { status: 'pass', detail: 'The profile is verified.' }
        : { status: 'fail', detail: 'Verify the profile. Unverified profiles cannot be fully managed and rarely rank well.' },
  )

  const cityTerms = ctx.cityTerms.filter((term) => !term.includes(','))
  if (!profile.business_name) {
    add('name', 'basics', 'Business name follows Google’s rules', 2, missing('the name shown on the profile'))
  } else {
    const brand = ctx.brand
    const extraCity = cityTerms.some((term) => countTerms(profile.business_name, [term]) > 0 && countTerms(brand, [term]) === 0)
    const extraService = ctx.typeStems.some(
      (stem) => new RegExp(`(?<![\\p{L}])${stem}`, 'iu').test(profile.business_name ?? '') && !new RegExp(`(?<![\\p{L}])${stem}`, 'iu').test(brand),
    )
    add('name', 'basics', 'Business name follows Google’s rules', 2,
      extraCity || extraService
        ? {
            status: 'warn',
            detail: `“${profile.business_name}” adds ${extraCity ? 'a location' : 'a service keyword'} to the business name “${brand}”. Google treats this as keyword stuffing and can suspend the profile; use the real-world name.`,
          }
        : compact(profile.business_name) === compact(brand)
          ? { status: 'pass', detail: 'The profile name matches the business name.' }
          : {
              status: 'warn',
              detail: `The profile name “${profile.business_name}” differs from the business name “${brand}”. Use the same name everywhere (signage, website, listings).`,
            },
    )
  }

  add('hours', 'basics', 'Opening hours are set', 2,
    profile.has_hours === null
      ? missing('whether opening hours are set')
      : profile.has_hours
        ? { status: 'pass', detail: 'Opening hours are set.' }
        : { status: 'fail', detail: 'Add opening hours. Profiles without hours look closed or inactive, and Google may show “Hours unknown”.' },
  )
  add('special_hours', 'basics', 'Holiday (special) hours are set', 1,
    profile.has_special_hours === null
      ? missing('whether special hours are set')
      : profile.has_special_hours
        ? { status: 'pass', detail: 'Special hours are set.' }
        : { status: 'warn', detail: 'Add special hours for upcoming holidays so customers are not turned away, and Google sees an active profile.' },
  )
  add('attributes', 'basics', 'Attributes are filled in', 1,
    profile.attributes_count === null
      ? missing('how many attributes are set')
      : profile.attributes_count >= 5
        ? { status: 'pass', detail: `${plural(profile.attributes_count, 'attribute')} set.` }
        : { status: 'warn', detail: `Only ${plural(profile.attributes_count, 'attribute')} set. Add every attribute that is true (for example payment methods, accessibility, “online estimates”).` },
  )
  add('booking', 'basics', 'Booking or quote link', 1,
    profile.has_booking_link === null
      ? missing('whether a booking link is set')
      : profile.has_booking_link
        ? { status: 'pass', detail: 'A booking or appointment link is set.' }
        : { status: 'warn', detail: 'Add an appointment or quote link so customers can act straight from the profile.' },
  )

  // ---- Categories and services --------------------------------------------------------------
  if (!profile.primary_category) {
    add('primary_category', 'categories', 'Primary category', 3, missing('the primary category'))
  } else {
    const related =
      ctx.typeStems.length === 0 ||
      ctx.typeStems.some((stem) => new RegExp(`(?<![\\p{L}])${stem}`, 'iu').test(profile.primary_category ?? ''))
    add('primary_category', 'categories', 'Primary category', 3,
      related
        ? { status: 'pass', detail: `The primary category is “${profile.primary_category}”.` }
        : {
            status: 'warn',
            detail: `The primary category “${profile.primary_category}” does not obviously match the business type “${project.business_type ?? ''}”. The primary category is the strongest ranking signal on the profile; pick the most specific one for the main service.`,
          },
    )
  }
  const extraCategories = profile.additional_categories.length
  add('additional_categories', 'categories', 'Additional categories', 1,
    extraCategories === 0
      ? profile.primary_category
        ? { status: 'warn', detail: 'No additional categories. Add the other categories that describe services you offer (Google allows up to 9).' }
        : missing('the categories')
      : extraCategories > 9
        ? { status: 'warn', detail: `${extraCategories} additional categories listed; Google allows 9. Keep the most relevant.` }
        : { status: 'pass', detail: `${plural(extraCategories, 'additional category', 'additional categories')}.` },
  )

  const gbpServices = profile.services
  if (gbpServices.length === 0) {
    add('services', 'categories', 'Services are listed', 2, {
      status: 'warn',
      detail: 'No services are listed (or none were entered here). List each service with a short description; it helps the profile show for those searches.',
    })
  } else {
    const projectServices = (project.services ?? []).filter((item) => item.trim())
    const gbpText = gbpServices.join(' | ')
    const notListed = projectServices.filter((service) => {
      const matcher = buildServiceMatcher(service)
      const lower = gbpText.toLowerCase()
      return !(lower.includes(matcher.terms[0] ?? '') || (matcher.stems.length > 0 && matcher.stems.every((stem) => lower.includes(stem))))
    })
    add('services', 'categories', 'Services are listed', 2,
      notListed.length > 0
        ? {
            status: 'warn',
            detail: `${plural(gbpServices.length, 'service')} listed, but not: ${notListed.slice(0, 6).join(', ')}${notListed.length > 6 ? '…' : ''} (from the project’s services).`,
          }
        : gbpServices.length < 5
          ? { status: 'warn', detail: `Only ${plural(gbpServices.length, 'service')} listed. Add every service you want to be found for.` }
          : { status: 'pass', detail: `${plural(gbpServices.length, 'service')} listed.` },
    )
  }
  add('products', 'categories', 'Products (or service showcases)', 1,
    profile.products_count === null
      ? missing('the number of products')
      : profile.products_count > 0
        ? { status: 'pass', detail: `${plural(profile.products_count, 'product')} listed.` }
        : { status: 'warn', detail: 'No products. Service businesses can add their main services as products, with a photo and price range, to stand out on the profile.' },
  )

  // ---- Contact and location -----------------------------------------------------------------
  add('phone', 'contact', 'Phone number', 2,
    profile.phone ? { status: 'pass', detail: `Phone: ${profile.phone}.` } : missing('the phone number on the profile'),
  )

  if (!profile.website_url) {
    add('website', 'contact', 'Website link', 2, missing('the website link on the profile'))
  } else {
    const gbpHost = bareHost(profile.website_url)
    const projectHost = bareHost(project.website_url)
    add('website', 'contact', 'Website link', 2,
      gbpHost && projectHost && gbpHost !== projectHost
        ? {
            status: 'fail',
            detail: `The profile links to ${gbpHost}, but the project website is ${projectHost}. Link the profile to the business’s own site.`,
          }
        : { status: 'pass', detail: `The profile links to ${profile.website_url}.` },
    )
  }

  if (profile.service_area_business) {
    const areas = profile.gbp_service_areas
    add('location', 'contact', 'Service areas on the profile', 2,
      areas.length === 0
        ? { status: 'fail', detail: 'This is a service-area business with no service areas listed. Add the cities you serve.' }
        : areas.length > 20
          ? { status: 'warn', detail: `${areas.length} service areas listed; Google allows 20. Keep the most important.` }
          : { status: 'pass', detail: `${plural(areas.length, 'service area')} listed.` },
    )
    const projectAreas = (project.service_areas ?? []).filter((item) => item.trim())
    if (projectAreas.length > 0 && areas.length > 0) {
      const gbpMatchers = areas.map(buildAreaMatcher)
      const notOnProfile = projectAreas.filter((area) => {
        const matcher = buildAreaMatcher(area)
        return !gbpMatchers.some((other) => other.slugs.some((slug) => matcher.slugs.includes(slug)))
      })
      add('area_match', 'contact', 'Profile covers the project’s service areas', 1,
        notOnProfile.length === 0
          ? { status: 'pass', detail: 'Every service area on the project is listed on the profile.' }
          : {
              status: 'warn',
              detail: `Not on the profile: ${notOnProfile.slice(0, 8).join(', ')}${notOnProfile.length > 8 ? '…' : ''}. Add them if the business serves them (up to 20 in total).`,
            },
      )
    }
  } else {
    add('location', 'contact', 'Business address', 2,
      profile.address
        ? { status: 'pass', detail: `Address: ${profile.address}.` }
        : missing('the address (or tick “service-area business” if customers are not served at an address)'),
    )
  }

  // ---- Description --------------------------------------------------------------------------
  const description = profile.description
  if (!description) {
    add('description', 'description', 'Description length', 2, missing('the business description'))
  } else {
    const length = description.length
    add('description', 'description', 'Description length', 2,
      length > 750
        ? { status: 'fail', detail: `${length} characters; Google allows 750. Shorten it, keeping the key services and areas near the start.` }
        : length < 250
          ? { status: 'warn', detail: `Only ${length} characters. Use most of the 750 available: what you do, where, and why customers choose you.` }
          : { status: 'pass', detail: `${length} of 750 characters used.` },
    )
    if (cityTerms.length > 0) {
      add('description_city', 'description', 'Description mentions the location', 1,
        countTerms(description, cityTerms) > 0
          ? { status: 'pass', detail: `Mentions ${ctx.locationLabel}.` }
          : { status: 'warn', detail: `Mention ${ctx.locationLabel} (and nearby areas you serve) in the description.` },
      )
    }
    const serviceWords = [...effectiveServices(project), profile.primary_category ?? ''].filter(Boolean)
    if (serviceWords.length > 0) {
      const lower = description.toLowerCase()
      const hit = serviceWords.some((service) => {
        const matcher = buildServiceMatcher(service)
        return lower.includes(matcher.terms[0] ?? '\u0000') || (matcher.stems.length > 0 && matcher.stems.some((stem) => lower.includes(stem)))
      })
      add('description_service', 'description', 'Description names the services', 1,
        hit
          ? { status: 'pass', detail: 'The description names what the business does.' }
          : { status: 'warn', detail: 'Name the main services in the description, in plain words customers search for.' },
      )
    }
    add('description_rules', 'description', 'No links or phone numbers in the description', 1,
      URL_IN_TEXT.test(description) || PHONE_IN_TEXT.test(description)
        ? { status: 'warn', detail: 'The description contains a web address or phone number. Google’s rules do not allow these there, and edits can be rejected.' }
        : { status: 'pass', detail: 'No links or phone numbers.' },
    )
  }

  // ---- Photos -------------------------------------------------------------------------------
  add('photos', 'photos', 'Number of photos', 2,
    profile.photos_count === null
      ? missing('the number of photos')
      : profile.photos_count >= 10
        ? { status: 'pass', detail: `${plural(profile.photos_count, 'photo')}. Keep adding recent ones of real work, team and premises.` }
        : profile.photos_count > 0
          ? { status: 'warn', detail: `Only ${plural(profile.photos_count, 'photo')}. Add at least 10 real photos (work, team, vehicles, premises), then a few more each month.` }
          : { status: 'fail', detail: 'No photos. Profiles with photos get far more requests for directions and website clicks.' },
  )
  add('logo', 'photos', 'Logo', 1,
    profile.has_logo === null
      ? missing('whether a logo is set')
      : profile.has_logo
        ? { status: 'pass', detail: 'A logo is set.' }
        : { status: 'warn', detail: 'Add the business logo.' },
  )
  add('cover', 'photos', 'Cover photo', 1,
    profile.has_cover_photo === null
      ? missing('whether a cover photo is set')
      : profile.has_cover_photo
        ? { status: 'pass', detail: 'A cover photo is set.' }
        : { status: 'warn', detail: 'Add a cover photo that shows the business at its best.' },
  )

  // ---- Reviews ------------------------------------------------------------------------------
  add('review_count', 'reviews', 'Number of reviews', 3,
    profile.review_count === null
      ? missing('the number of reviews')
      : profile.review_count >= 25
        ? { status: 'pass', detail: `${plural(profile.review_count, 'review')}.` }
        : profile.review_count >= 10
          ? { status: 'warn', detail: `${plural(profile.review_count, 'review')}. Ask every happy customer; aim for 25+ and to beat the top local competitors.` }
          : { status: 'fail', detail: `Only ${plural(profile.review_count, 'review')}. Reviews are a major local ranking factor; set up a routine to request them after every job.` },
  )
  add('rating', 'reviews', 'Average rating', 3,
    profile.rating === null
      ? missing('the average rating')
      : profile.rating >= 4.5
        ? { status: 'pass', detail: `Rated ${profile.rating.toFixed(1)}.` }
        : profile.rating >= 4
          ? { status: 'warn', detail: `Rated ${profile.rating.toFixed(1)}. More recent positive reviews will lift it; reply to every negative one.` }
          : { status: 'fail', detail: `Rated ${profile.rating.toFixed(1)}. Many customers filter out businesses under 4 stars; fix the causes and ask satisfied customers for reviews.` },
  )
  add('review_recency', 'reviews', 'Recent reviews (last 90 days)', 2,
    profile.reviews_last_90_days === null
      ? missing('how many reviews arrived in the last 90 days')
      : profile.reviews_last_90_days >= 3
        ? { status: 'pass', detail: `${plural(profile.reviews_last_90_days, 'review')} in the last 90 days.` }
        : profile.reviews_last_90_days > 0
          ? { status: 'warn', detail: `Only ${plural(profile.reviews_last_90_days, 'review')} in the last 90 days. A steady flow of new reviews matters as much as the total.` }
          : { status: 'fail', detail: 'No reviews in the last 90 days. Customers and Google both favour recent reviews.' },
  )
  add('reply_rate', 'reviews', 'Owner replies to reviews', 2,
    profile.reply_rate === null
      ? missing('the share of reviews with an owner reply')
      : profile.reply_rate >= 90
        ? { status: 'pass', detail: `${profile.reply_rate}% of reviews have a reply.` }
        : profile.reply_rate >= 50
          ? { status: 'warn', detail: `${profile.reply_rate}% of reviews have a reply. Reply to every review, good and bad, within a few days.` }
          : { status: 'fail', detail: `Only ${profile.reply_rate}% of reviews have a reply. Replying shows you are active and lets you address complaints publicly.` },
  )

  // ---- Posts --------------------------------------------------------------------------------
  if (!profile.last_post_date) {
    add('posts', 'posts', 'Recent Google posts', 2, missing('the date of the latest post (leave empty if there are none, then set it once you post)'))
  } else {
    const age = daysBetween(profile.last_post_date, today)
    add('posts', 'posts', 'Recent Google posts', 2,
      age <= 30
        ? { status: 'pass', detail: `Last post ${age === 0 ? 'today' : `${plural(age, 'day')} ago`}.` }
        : age <= 90
          ? { status: 'warn', detail: `Last post ${plural(age, 'day')} ago. Post at least every couple of weeks: offers, recent jobs, tips.` }
          : { status: 'fail', detail: `Last post ${plural(age, 'day')} ago. The profile looks inactive; start a regular posting routine.` },
    )
  }

  // ---- Website consistency (needs a crawl) --------------------------------------------------
  const pages = (sitePages ?? []).filter((page) => page.error === null && page.status_code !== null && page.status_code < 400)
  const crawlUsed = pages.length > 0
  const noCrawl: Partial3 = { status: 'info', detail: 'Crawl the website to compare it with the profile.' }

  if (!crawlUsed) {
    add('site_phone', 'website', 'Same phone number as the website', 2, noCrawl)
    add('site_name', 'website', 'Same name as the website’s structured data', 1, noCrawl)
    if (!profile.service_area_business) add('site_address', 'website', 'Same address as the website', 2, noCrawl)
  } else {
    // Phone
    const sitePhones = new Map<string, string>()
    for (const page of pages) {
      for (const phone of page.phones) sitePhones.set(phoneKey(phone), phone)
      if (page.schema_local?.telephone) sitePhones.set(phoneKey(page.schema_local.telephone), page.schema_local.telephone)
    }
    if (!profile.phone) {
      add('site_phone', 'website', 'Same phone number as the website', 2, missing('the phone number on the profile'))
    } else {
      add('site_phone', 'website', 'Same phone number as the website', 2,
        sitePhones.size === 0
          ? { status: 'warn', detail: 'No phone number was found on the website. Show the same number as the profile on every page (header or footer).' }
          : sitePhones.has(phoneKey(profile.phone))
            ? { status: 'pass', detail: 'The profile’s phone number appears on the website.' }
            : {
                status: 'fail',
                detail: `The profile shows ${profile.phone}, but the website shows ${[...sitePhones.values()].slice(0, 3).join(', ')}. Use one number everywhere (a tracking number on the profile is fine if the website’s main number is listed as an additional phone).`,
              },
      )
    }

    // Name in structured data
    const schemaNames = [...new Set(pages.map((page) => page.schema_local?.name).filter((name): name is string => !!name))]
    if (!profile.business_name) {
      add('site_name', 'website', 'Same name as the website’s structured data', 1, missing('the name shown on the profile'))
    } else {
      add('site_name', 'website', 'Same name as the website’s structured data', 1,
        schemaNames.length === 0
          ? { status: 'info', detail: 'The website has no LocalBusiness structured data to compare (the Local Page Auditor covers adding it).' }
          : schemaNames.some((name) => compact(name) === compact(profile.business_name))
            ? { status: 'pass', detail: 'The structured data uses the same name.' }
            : { status: 'warn', detail: `The website’s structured data says “${schemaNames[0]}”, the profile says “${profile.business_name}”. Make them match.` },
      )
    }

    // Address
    if (!profile.service_area_business) {
      const siteAddresses = pages.flatMap((page) => [page.address_text, page.schema_local?.address ?? null]).filter((value): value is string => !!value)
      const gbpKey = streetKey(profile.address)
      if (!profile.address) {
        add('site_address', 'website', 'Same address as the website', 2, missing('the address on the profile'))
      } else if (siteAddresses.length === 0) {
        add('site_address', 'website', 'Same address as the website', 2, {
          status: 'warn',
          detail: 'No address was found on the website. Show the same address as the profile on the contact page and in structured data.',
        })
      } else if (!gbpKey) {
        add('site_address', 'website', 'Same address as the website', 2, {
          status: 'info',
          detail: 'The profile address has no street number to compare.',
        })
      } else {
        const matched = siteAddresses.some((address) => streetKey(address) === gbpKey)
        add('site_address', 'website', 'Same address as the website', 2,
          matched
            ? { status: 'pass', detail: 'The website shows the same street address.' }
            : { status: 'fail', detail: `The website’s address (${siteAddresses[0]}) does not match the profile (${profile.address}). Use one format everywhere.` },
        )
      }
    }
  }

  // ---- Totals -------------------------------------------------------------------------------
  const counts: Record<GbpStatus, number> = { pass: 0, warn: 0, fail: 0, missing: 0, info: 0 }
  let earned = 0
  let possible = 0
  for (const check of checks) {
    counts[check.status] += 1
    if (check.status === 'pass' || check.status === 'warn' || check.status === 'fail') {
      possible += check.weight
      earned += check.status === 'pass' ? check.weight : check.status === 'warn' ? check.weight / 2 : 0
    }
  }

  const topFixes = checks
    .filter((check) => check.status === 'fail' || check.status === 'warn')
    .sort((a, b) => (a.status === b.status ? 0 : a.status === 'fail' ? -1 : 1) || b.weight - a.weight)

  return {
    checks,
    groups: GROUP_ORDER.map((group) => ({
      group,
      label: GBP_GROUP_LABELS[group],
      checks: checks.filter((check) => check.group === group),
    })).filter((entry) => entry.checks.length > 0),
    score: possible === 0 ? null : Math.round((earned / possible) * 100),
    counts,
    topFixes,
    missing: [...new Set(checks.filter((check) => check.status === 'missing').map((check) => check.label))],
    crawlUsed,
  }
}
