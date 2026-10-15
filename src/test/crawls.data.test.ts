import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, invokeMock } = vi.hoisted(() => ({ fromMock: vi.fn(), invokeMock: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabase: { from: fromMock, functions: { invoke: invokeMock } } }))

import {
  describeStopReason,
  filterPages,
  getCrawlErrorMessage,
  getLatestCrawl,
  listCrawlPages,
  startCrawl,
  summarizeCrawl,
} from '../lib/crawls'
import { formatDateTime } from '../lib/format'

const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const CRAWL_ID = '33333333-3333-4333-8333-333333333333'

beforeEach(() => {
  fromMock.mockReset()
  invokeMock.mockReset()
})

function httpError(status: number, body: unknown) {
  return { name: 'FunctionsHttpError', context: new Response(JSON.stringify(body), { status }) }
}

describe('getCrawlErrorMessage', () => {
  it('shows the friendly message the function returned', async () => {
    const message = await getCrawlErrorMessage(httpError(409, { error: 'A crawl is already running for this project.' }))
    expect(message).toBe('A crawl is already running for this project.')
  })

  it('explains a missing deployment when the function is not found', async () => {
    const message = await getCrawlErrorMessage(httpError(404, { code: 'NOT_FOUND', message: 'Requested function was not found' }))
    expect(message).toMatch(/not available yet.*deploy/i)
  })

  it('maps expired sessions, network failures and unknown errors', async () => {
    expect(await getCrawlErrorMessage(httpError(401, { message: 'Invalid JWT' }))).toMatch(/session has expired/i)
    expect(await getCrawlErrorMessage({ name: 'FunctionsFetchError' })).toMatch(/could not reach the server/i)
    expect(await getCrawlErrorMessage(httpError(500, 'not json object'))).toMatch(/could not be completed/i)
    expect(await getCrawlErrorMessage(null)).toMatch(/could not be completed/i)
  })

  it('ignores absurdly long server messages', async () => {
    const message = await getCrawlErrorMessage(httpError(500, { error: 'x'.repeat(1000) }))
    expect(message).toMatch(/could not be completed/i)
  })
})

describe('startCrawl', () => {
  it('rejects a malformed project id without calling the server', async () => {
    const result = await startCrawl('not-a-uuid')
    expect(result.data).toBeNull()
    expect(invokeMock).not.toHaveBeenCalled()
  })

  it('invokes crawl-site with only the project id and returns the result', async () => {
    invokeMock.mockResolvedValue({ data: { crawlId: CRAWL_ID, pagesCrawled: 7 }, error: null })
    const result = await startCrawl(PROJECT_ID)
    expect(invokeMock).toHaveBeenCalledWith('crawl-site', { body: { projectId: PROJECT_ID } })
    expect(result).toEqual({ data: { crawlId: CRAWL_ID, pagesCrawled: 7 }, error: null })
  })

  it('returns a friendly error when the function fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: httpError(422, { error: 'This website cannot be crawled.' }) })
    const result = await startCrawl(PROJECT_ID)
    expect(result).toEqual({ data: null, error: 'This website cannot be crawled.' })
  })

  it('treats an unexpected response shape as a failure', async () => {
    invokeMock.mockResolvedValue({ data: { nope: true }, error: null })
    expect((await startCrawl(PROJECT_ID)).error).toMatch(/could not be completed/i)
  })

  it('never throws on thrown errors', async () => {
    invokeMock.mockRejectedValue({ name: 'FunctionsFetchError' })
    expect((await startCrawl(PROJECT_ID)).error).toMatch(/could not reach the server/i)
  })
})

describe('getLatestCrawl / listCrawlPages', () => {
  it('queries the newest crawl for the project', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: CRAWL_ID }, error: null })
    const limit = vi.fn(() => ({ maybeSingle }))
    const order = vi.fn(() => ({ limit }))
    const eq = vi.fn(() => ({ order }))
    fromMock.mockReturnValue({ select: () => ({ eq }) })

    const result = await getLatestCrawl(PROJECT_ID)

    expect(fromMock).toHaveBeenCalledWith('crawls')
    expect(eq).toHaveBeenCalledWith('project_id', PROJECT_ID)
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result.data).toEqual({ id: CRAWL_ID })
  })

  it('maps database errors, including a missing table, to friendly messages', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: { code: '42P01', message: 'relation does not exist' } })
    fromMock.mockReturnValue({ select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle }) }) }) }) })
    const result = await getLatestCrawl(PROJECT_ID)
    expect(result.data).toBeNull()
    expect(result.error).toMatch(/apply the SQL migration/i)
  })

  it('returns "never crawled" for an invalid id without querying', async () => {
    expect(await getLatestCrawl('bad')).toEqual({ data: null, error: null })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('lists pages ordered by depth then url', async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 'p1' }], error: null })
    const order2 = vi.fn(() => ({ limit }))
    const order1 = vi.fn(() => ({ order: order2 }))
    fromMock.mockReturnValue({ select: () => ({ eq: () => ({ order: order1 }) }) })

    const result = await listCrawlPages(CRAWL_ID)

    expect(order1).toHaveBeenCalledWith('depth', { ascending: true })
    expect(order2).toHaveBeenCalledWith('url', { ascending: true })
    expect(result.data).toEqual([{ id: 'p1' }])
  })
})

describe('summarizeCrawl / filterPages', () => {
  const pages = [
    { issues: ['missing_title', 'thin_content'] }, // error page
    { issues: ['thin_content', 'missing_canonical'] }, // warning page
    { issues: ['missing_canonical'] }, // notice only
    { issues: [] },
    { issues: ['made_up_code'] }, // unknown codes are ignored
  ]

  it('counts pages by worst severity and tallies each issue once per page', () => {
    const summary = summarizeCrawl(pages)
    expect(summary.totalPages).toBe(5)
    expect(summary.pagesWithErrors).toBe(1)
    expect(summary.pagesWithWarnings).toBe(1)
    expect(summary.cleanPages).toBe(2)
    expect(summary.issueCounts).toEqual([
      { code: 'missing_title', severity: 'error', count: 1 },
      { code: 'thin_content', severity: 'warning', count: 2 },
      { code: 'missing_canonical', severity: 'info', count: 2 },
    ])
  })

  it('handles an empty crawl', () => {
    expect(summarizeCrawl([])).toEqual({
      totalPages: 0,
      pagesWithErrors: 0,
      pagesWithWarnings: 0,
      cleanPages: 0,
      issueCounts: [],
    })
  })

  it('filters by severity', () => {
    expect(filterPages(pages, 'all')).toHaveLength(5)
    expect(filterPages(pages, 'errors')).toEqual([pages[0]])
    expect(filterPages(pages, 'warnings')).toEqual([pages[1]])
    expect(filterPages(pages, 'clean')).toEqual([pages[2], pages[3], pages[4]])
  })
})

describe('describeStopReason', () => {
  it('explains early stops and stays quiet otherwise', () => {
    expect(describeStopReason('page_limit')).toMatch(/25-page limit/)
    expect(describeStopReason('time_limit')).toMatch(/ran out of time/)
    expect(describeStopReason('blocked_by_robots')).toMatch(/robots\.txt/)
    expect(describeStopReason('completed')).toBeNull()
    expect(describeStopReason(null)).toBeNull()
  })
})

describe('formatDateTime', () => {
  it('formats a timestamp with date and time', () => {
    expect(formatDateTime('2026-10-15T15:30:00Z', { timeZone: 'UTC' })).toBe('Oct 15, 2026, 3:30 PM')
  })

  it('returns a dash for empty or invalid input', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('')).toBe('—')
    expect(formatDateTime('nonsense')).toBe('—')
  })
})
