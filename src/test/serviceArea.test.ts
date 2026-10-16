import { describe, expect, it } from 'vitest'
import {
  MAX_LIST_ITEMS,
  analyzeCoverage,
  buildAreaMatcher,
  buildServiceMatcher,
  effectiveAreas,
  effectiveServices,
  parseList,
  shingles,
  similarity,
  slugify,
  suggestAreasFromSite,
  type AreaResult,
  type CoverageReport,
} from '../lib/serviceArea'
import { makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Acme',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
  service_areas: ['Austin, TX', 'Round Rock, TX', 'Cedar Park, TX', 'Leander, TX', 'Pflugerville, TX', 'Georgetown, TX'],
  services: ['Drain cleaning', 'Water heater repair'],
})

function words(n: number, seed: string): string {
  return Array.from({ length: n }, (_, i) => `${seed}${i % 97}`).join(' ')
}

const TEMPLATE = (city: string) =>
  `Looking for drain cleaning in ${city}? Our licensed plumbers serve every street in ${city} with same day visits, ` +
  'upfront prices and a one year guarantee on every repair we make for local homeowners and landlords. '.repeat(12) +
  `Call today for drain cleaning in ${city}.`

const AREA_LINKS = ['/service-areas/austin', '/service-areas/round-rock', '/service-areas/cedar-park', '/service-areas/leander']

const pages = [
  makeCrawlPage({ url: 'https://acme.example/', title: 'Acme Plumbing', h1: 'Plumbers you can trust', link_paths: AREA_LINKS }),
  makeCrawlPage({
    url: 'https://acme.example/service-areas/austin',
    title: 'Drain Cleaning in Austin, TX | Acme Plumbing',
    h1: 'Drain cleaning in Austin',
    word_count: 650,
    body_text: `Austin homes on the east side and in Mueller. Drain cleaning across Austin. ${words(600, 'austinunique')}`,
  }),
  makeCrawlPage({
    url: 'https://acme.example/service-areas/round-rock',
    title: 'Service area | Acme Plumbing',
    h1: 'Round Rock plumbing',
    word_count: 120,
    body_text: 'We serve Round Rock. Drain cleaning available.',
  }),
  makeCrawlPage({
    url: 'https://acme.example/service-areas/cedar-park',
    title: 'Drain Cleaning in Cedar Park | Acme Plumbing',
    h1: 'Cedar Park drain cleaning',
    word_count: 480,
    body_text: TEMPLATE('Cedar Park'),
  }),
  makeCrawlPage({
    url: 'https://acme.example/service-areas/leander',
    title: 'Drain Cleaning in Leander | Acme Plumbing',
    h1: 'Leander drain cleaning',
    word_count: 480,
    body_text: TEMPLATE('Leander'),
  }),
  makeCrawlPage({
    url: 'https://acme.example/blog/winter-pipes',
    title: 'Protect your pipes this winter',
    h1: 'Winter pipes',
    body_text: 'Homes in Pflugerville saw many frozen pipes last year.',
  }),
  // ignored: broken page and a redirect that mention Georgetown
  makeCrawlPage({ url: 'https://acme.example/georgetown', status_code: 404, title: 'Georgetown', h1: 'Georgetown' }),
  makeCrawlPage({ url: 'https://acme.example/gt', final_url: 'https://acme.example/', title: 'Georgetown', h1: 'Georgetown' }),
]

function area(report: CoverageReport, name: string): AreaResult {
  const found = report.areas.find((result) => result.area.name === name)
  if (!found) throw new Error(`no area ${name}`)
  return found
}

describe('parseList', () => {
  it('splits lines and semicolons, trims, keeps commas and drops duplicates', () => {
    expect(parseList('  Austin, TX \n\nround rock; Round Rock\n  Cedar   Park ')).toEqual(['Austin, TX', 'round rock', 'Cedar Park'])
  })

  it('caps the number and length of items', () => {
    const many = Array.from({ length: 150 }, (_, i) => `Town ${i}`).join('\n')
    expect(parseList(many)).toHaveLength(MAX_LIST_ITEMS)
    expect(parseList('x'.repeat(300))[0]).toHaveLength(100)
  })
})

describe('matchers', () => {
  it('builds name, region, text variants and slugs for an area', () => {
    const matcher = buildAreaMatcher('St. Louis, MO')
    expect(matcher.name).toBe('St. Louis')
    expect(matcher.region).toBe('MO')
    expect(matcher.terms).toEqual(expect.arrayContaining(['st. louis', 'st louis', 'saint louis']))
    expect(matcher.slugs).toEqual(expect.arrayContaining(['st-louis', 'saint-louis', 'stlouis']))
  })

  it('slugifies accents', () => {
    expect(slugify('Cañon City')).toBe('canon-city')
  })

  it('builds service word stems', () => {
    expect(buildServiceMatcher('Water heater repair').stems).toEqual(['water', 'heat', 'repair'])
  })

  it('falls back to the primary location and business type', () => {
    const bare = makeProject({ location: 'Austin, TX', business_type: 'Plumber' })
    expect(effectiveAreas(bare)).toEqual(['Austin, TX'])
    expect(effectiveServices(bare)).toEqual(['Plumber'])
    expect(effectiveAreas(makeProject())).toEqual([])
  })
})

describe('analyzeCoverage', () => {
  const report = analyzeCoverage(project, pages)

  it('marks an area with a strong, linked, unique page as covered', () => {
    const austin = area(report, 'Austin')
    expect(austin.status).toBe('covered')
    expect(austin.bestPage?.url).toBe('https://acme.example/service-areas/austin')
    expect(austin.issues).toEqual([])
  })

  it('flags a thin page without the area in its title', () => {
    const roundRock = area(report, 'Round Rock')
    expect(roundRock.status).toBe('needs_work')
    expect(roundRock.issues.map((issue) => issue.id)).toEqual(expect.arrayContaining(['title', 'thin', 'mentions']))
    expect(roundRock.issues.find((issue) => issue.id === 'title')?.severity).toBe('fail')
  })

  it('detects area pages that are the same text with the city swapped', () => {
    expect(report.duplicates).toHaveLength(1)
    expect([report.duplicates[0]?.areaA, report.duplicates[0]?.areaB].sort()).toEqual(['Cedar Park', 'Leander'])
    expect(area(report, 'Cedar Park').status).toBe('needs_work')
    expect(area(report, 'Cedar Park').issues.map((issue) => issue.id)).toContain('duplicate')
  })

  it('separates mentioned-only areas from areas with no content, ignoring broken pages and redirects', () => {
    expect(area(report, 'Pflugerville')).toMatchObject({ status: 'mentioned', mentionPages: 1, bestPage: null })
    expect(area(report, 'Georgetown')).toMatchObject({ status: 'missing', mentionPages: 0, bestPage: null })
    expect(report.usablePages).toBe(6)
  })

  it('totals statuses and the coverage percentage', () => {
    expect(report.totals).toEqual({ covered: 1, needs_work: 3, mentioned: 1, missing: 1 })
    expect(report.coveragePercent).toBe(67)
  })

  it('suggests pages for gaps in list order, in the folder existing area pages use', () => {
    const gaps = report.suggestions.filter((suggestion) => suggestion.reason !== 'service_gap')
    expect(gaps.map((suggestion) => suggestion.area)).toEqual(['Pflugerville, TX', 'Georgetown, TX'])
    expect(gaps[0]).toMatchObject({
      url: '/service-areas/pflugerville/',
      h1: 'Drain Cleaning in Pflugerville, TX',
      title: 'Drain Cleaning in Pflugerville, TX | Acme Plumbing',
      reason: 'mentioned',
    })
    expect(report.areaPathPrefix).toBe('/service-areas/')
  })

  it('builds the services-by-area grid and suggests missing combinations', () => {
    const matrix = report.matrix
    expect(matrix?.services).toEqual(['Drain cleaning', 'Water heater repair'])
    expect(matrix?.cells[0]?.[0]?.pageUrl).toBe('https://acme.example/service-areas/austin')
    expect(matrix?.cells[1]?.[0]?.pageUrl).toBeNull()
    expect(matrix?.covered).toBe(3) // drain cleaning: Austin, Cedar Park, Leander
    expect(report.suggestions).toContainEqual(
      expect.objectContaining({ reason: 'service_gap', service: 'Water heater repair', url: '/service-areas/austin/water-heater-repair/' }),
    )
  })

  it('flags noindex pages, missing services and pages nothing links to', () => {
    const result = analyzeCoverage(makeProject({ service_areas: ['Austin'], services: ['Roofing'], business_name: 'Acme' }), [
      makeCrawlPage({
        url: 'https://acme.example/austin',
        title: 'Austin',
        h1: 'Austin',
        robots_meta: 'noindex, follow',
        body_text: `Austin Austin ${words(400, 'x')}`,
      }),
    ])
    const ids = result.areas[0]?.issues.map((issue) => issue.id)
    expect(ids).toEqual(expect.arrayContaining(['noindex', 'service', 'orphan']))
    expect(result.areas[0]?.status).toBe('needs_work')
  })

  it('matches whole words only, and the URL slug as whole words', () => {
    const result = analyzeCoverage(makeProject({ service_areas: ['Rock'] }), [
      makeCrawlPage({ url: 'https://acme.example/round-rocky-road', title: 'Rocky', h1: 'Rocky', body_text: 'rocky road' }),
    ])
    expect(result.areas[0]?.status).toBe('missing')
  })

  it('uses the primary location when no areas are saved', () => {
    const result = analyzeCoverage(makeProject({ location: 'Austin, TX', business_name: 'Acme' }), pages)
    expect(result.areas.map((r) => r.area.label)).toEqual(['Austin, TX'])
    expect(result.matrix).toBeNull()
  })

  it('reports multiple pages competing for one area', () => {
    const result = analyzeCoverage(makeProject({ service_areas: ['Austin'] }), [
      makeCrawlPage({ url: 'https://acme.example/austin-plumbing', link_paths: ['/austin-drains'] }),
      makeCrawlPage({ url: 'https://acme.example/austin-drains', link_paths: ['/austin-plumbing'] }),
    ])
    expect(result.areas[0]?.otherDedicated).toHaveLength(1)
    expect(result.areas[0]?.issues.map((issue) => issue.id)).toContain('competing')
  })
})

describe('similarity', () => {
  it('scores the same template with different cities as near-identical, and different text low', () => {
    const areas = [buildAreaMatcher('Leander'), buildAreaMatcher('Cedar Park')]
    expect(similarity(shingles(TEMPLATE('Leander'), areas), shingles(TEMPLATE('Cedar Park'), areas))).toBeGreaterThan(0.9)
    expect(similarity(shingles(words(200, 'a'), areas), shingles(words(200, 'b'), areas))).toBe(0)
  })

  it('ignores very short texts', () => {
    expect(similarity(shingles('one two three four five six', []), shingles('one two three four five six', []))).toBe(0)
  })
})

describe('suggestAreasFromSite', () => {
  it('finds place names in area folders that are not in the list yet', () => {
    const found = suggestAreasFromSite(
      [
        makeCrawlPage({ url: 'https://acme.example/service-areas/round-rock/' }),
        makeCrawlPage({ url: 'https://acme.example/locations/hutto' }),
        makeCrawlPage({ url: 'https://acme.example/locations/austin' }),
        makeCrawlPage({ url: 'https://acme.example/areas/cedar-park', status_code: 404 }),
        makeCrawlPage({ url: 'https://acme.example/services/drains' }),
      ],
      ['Austin, TX'],
    )
    expect(found).toEqual(['Round Rock', 'Hutto'])
  })
})
