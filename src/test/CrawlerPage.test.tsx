import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { CrawlRow, ProjectRow } from '../types/database'
import { CRAWL_ID, PROJECT_ID, makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const { listProjectsMock, startCrawlMock, getLatestCrawlMock, listCrawlPagesMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  startCrawlMock: vi.fn(),
  getLatestCrawlMock: vi.fn(),
  listCrawlPagesMock: vi.fn(),
}))

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  listProjects: listProjectsMock,
}))
vi.mock('../lib/crawls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/crawls')>()),
  startCrawl: startCrawlMock,
  getLatestCrawl: getLatestCrawlMock,
  listCrawlPages: listCrawlPagesMock,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { CrawlerPage } from '../pages/CrawlerPage'

const project: ProjectRow = makeProject()
const crawl: CrawlRow = makeCrawl({ stopped_reason: 'page_limit' })
const page = makeCrawlPage

const pages = [
  page({ issues: ['missing_meta_description'] }),
  page({ url: 'https://acme.example/gone', status_code: 404, title: null, h1: null, word_count: 0, issues: ['http_error'] }),
]

function renderPage(entry = `/crawler?project=${PROJECT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <CrawlerPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listProjectsMock.mockReset().mockResolvedValue({ data: [project], error: null })
  startCrawlMock.mockReset()
  getLatestCrawlMock.mockReset().mockResolvedValue({ data: crawl, error: null })
  listCrawlPagesMock.mockReset().mockResolvedValue({ data: pages, error: null })
})

describe('CrawlerPage', () => {
  it('shows an empty state with a link to create a project when there are none', async () => {
    listProjectsMock.mockResolvedValue({ data: [], error: null })
    renderPage('/crawler')
    expect(await screen.findByText('Create a project to crawl its website')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/projects/new')
  })

  it('shows an error when projects fail to load', async () => {
    listProjectsMock.mockResolvedValue({ data: null, error: 'Could not reach the server.' })
    renderPage('/crawler')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
  })

  it('asks the user to choose a project when none is selected', async () => {
    renderPage('/crawler')
    expect(await screen.findByText('Choose a project')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start crawl' })).toBeDisabled()
    expect(getLatestCrawlMock).not.toHaveBeenCalled()
  })

  it('invites a first crawl when the project has never been crawled', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: null, error: null })
    renderPage()
    expect(await screen.findByText('This website has not been crawled yet')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start crawl' })).toBeEnabled()
  })

  it('renders real summary numbers, the issue breakdown, the stop note and the pages table', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Latest crawl' })).toBeInTheDocument()

    const summary = screen.getByRole('heading', { name: 'Latest crawl' }).closest('section') as HTMLElement
    expect(within(summary).getByText('Pages crawled').nextElementSibling).toHaveTextContent('2')
    expect(within(summary).getByText('Pages with errors').nextElementSibling).toHaveTextContent('1')
    expect(within(summary).getByText('Pages with warnings').nextElementSibling).toHaveTextContent('1')
    expect(screen.getByText(/stopped at the 1,000-page limit/i)).toBeInTheDocument()

    const breakdown = screen.getByRole('heading', { name: 'Issues found' }).closest('section') as HTMLElement
    expect(within(breakdown).getByText('Returns an error status (4xx/5xx)')).toBeInTheDocument()
    expect(within(breakdown).getByText('Missing meta description')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Crawled pages' })
    expect(within(table).getAllByRole('row')).toHaveLength(3) // header + 2 pages
    expect(within(table).getByText('404')).toBeInTheDocument()
    expect(screen.getByText('Crawl again', { exact: false })).toBeInTheDocument()
  })

  it('filters the pages table', async () => {
    const user = userEvent.setup()
    renderPage()
    const table = await screen.findByRole('table', { name: 'Crawled pages' })
    await user.selectOptions(screen.getByLabelText('Filter pages'), 'errors')
    expect(within(table).getAllByRole('row')).toHaveLength(2)
    expect(within(table).getByText('404')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Filter pages'), 'clean')
    expect(screen.getByText('No pages match this filter.')).toBeInTheDocument()
  })

  it('starts a crawl, blocks double submits while running, then reloads results', async () => {
    const user = userEvent.setup()
    let finish: (value: unknown) => void = () => undefined
    startCrawlMock.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    renderPage()
    const button = await screen.findByRole('button', { name: /crawl again/i })

    await user.click(button)
    const busy = await screen.findByRole('button', { name: /crawling/i })
    expect(busy).toBeDisabled()
    expect(screen.getByText('Crawl in progress')).toBeInTheDocument()
    await user.click(busy)
    expect(startCrawlMock).toHaveBeenCalledTimes(1)
    expect(startCrawlMock).toHaveBeenCalledWith(PROJECT_ID, { onProgress: expect.any(Function) })

    const callsBefore = getLatestCrawlMock.mock.calls.length
    finish({ data: { crawlId: CRAWL_ID, pagesCrawled: 2 }, error: null })

    expect(await screen.findByText(/Crawl finished: 2 pages checked/)).toBeInTheDocument()
    await waitFor(() => expect(getLatestCrawlMock.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('shows live progress while a large crawl runs in parts', async () => {
    const user = userEvent.setup()
    let finish: (value: unknown) => void = () => undefined
    startCrawlMock.mockImplementation((_id: string, options: { onProgress: (p: { crawlId: string; pagesCrawled: number }) => void }) => {
      options.onProgress({ crawlId: CRAWL_ID, pagesCrawled: 250 })
      return new Promise((resolve) => (finish = resolve))
    })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /crawl again/i }))
    expect(await screen.findByText(/250 pages so far/)).toBeInTheDocument()
    finish({ data: { crawlId: CRAWL_ID, pagesCrawled: 1000 }, error: null })
    expect(await screen.findByText(/Crawl finished: 1000 pages checked/)).toBeInTheDocument()
  })

  it('offers to resume a crawl that stopped part-way', async () => {
    const user = userEvent.setup()
    getLatestCrawlMock.mockResolvedValue({
      data: { ...crawl, status: 'running', stopped_reason: null, pages_crawled: 480, last_activity_at: '2020-01-01T00:00:00Z' },
      error: null,
    })
    startCrawlMock.mockResolvedValue({ data: { crawlId: CRAWL_ID, pagesCrawled: 1000 }, error: null })
    renderPage()
    expect(await screen.findByText('This crawl did not finish')).toBeInTheDocument()
    expect(screen.getByText(/480 pages were saved/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Resume crawl' }))
    expect(startCrawlMock).toHaveBeenCalledWith(PROJECT_ID, { crawlId: CRAWL_ID, onProgress: expect.any(Function) })
  })

  it('shows large page lists 100 rows at a time', async () => {
    const user = userEvent.setup()
    const many = Array.from({ length: 250 }, (_, index) =>
      page({ id: `page-${index}`, url: `https://acme.example/p${index}`, issues: [] }),
    )
    listCrawlPagesMock.mockResolvedValue({ data: many, error: null })
    renderPage()
    const table = await screen.findByRole('table', { name: 'Crawled pages' })
    expect(within(table).getAllByRole('row')).toHaveLength(101)
    expect(screen.getByText('Showing 100 of 250 pages')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show more' }))
    expect(within(table).getAllByRole('row')).toHaveLength(251)
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('shows the server error when the crawl fails', async () => {
    const user = userEvent.setup()
    startCrawlMock.mockResolvedValue({ data: null, error: 'A crawl is already running for this project.' })
    renderPage()
    await user.click(await screen.findByRole('button', { name: /crawl again/i }))
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The crawl did not complete')
    expect(alert).toHaveTextContent('A crawl is already running for this project.')
    expect(screen.getByRole('button', { name: /crawl again/i })).toBeEnabled()
  })

  it('shows a failed crawl’s error message', async () => {
    getLatestCrawlMock.mockResolvedValue({
      data: { ...crawl, status: 'failed', error_message: 'Could not save the crawl results.' },
      error: null,
    })
    listCrawlPagesMock.mockResolvedValue({ data: [], error: null })
    renderPage()
    expect(await screen.findByText('This crawl failed')).toBeInTheDocument()
    expect(screen.getByText('Could not save the crawl results.')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('points to the migration when crawl data cannot be loaded', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: null, error: 'Something went wrong. Please try again.' })
    renderPage()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not load crawl results')
    expect(alert).toHaveTextContent('20261016000000_crawls.sql')
  })
})
