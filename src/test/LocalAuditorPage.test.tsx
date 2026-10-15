import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listProjectsMock, getLatestCrawlMock, listCrawlPagesMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  getLatestCrawlMock: vi.fn(),
  listCrawlPagesMock: vi.fn(),
}))

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  listProjects: listProjectsMock,
}))
vi.mock('../lib/crawls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/crawls')>()),
  getLatestCrawl: getLatestCrawlMock,
  listCrawlPages: listCrawlPagesMock,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { LocalAuditorPage } from '../pages/LocalAuditorPage'
import { PROJECT_ID, makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Acme Plumbing',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
})

const body = 'Acme Plumbing serves Austin homeowners with fast plumbing. '.repeat(30)

const home = makeCrawlPage({
  url: 'https://acme.example/',
  title: 'Plumber in Austin, TX | Acme Plumbing',
  meta_description: 'Plumbing repairs in Austin by Acme Plumbing.',
  h1: 'Austin Plumber',
  h2s: ['Services', 'About'],
  body_text: body,
  word_count: 600,
  phones: ['(512) 555-0142'],
  tel_links: 1,
  address_text: '12 Main St',
  link_paths: ['/contact'],
  schema_local: { types: ['Plumber'], name: 'Acme Plumbing', telephone: '(512) 555-0142', address: 'Austin, TX', has_geo: false, has_hours: false, same_as_count: 0, has_rating: false, url: null },
})
const service = makeCrawlPage({
  url: 'https://acme.example/services/drains',
  title: 'Drains | Acme Plumbing',
  h1: 'Drains',
  body_text: 'Drains.',
  word_count: 120,
  phones: [],
})
const blog = makeCrawlPage({ url: 'https://acme.example/blog/tips', title: 'Tips' })

function renderPage(entry = `/page-auditor?project=${PROJECT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <LocalAuditorPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listProjectsMock.mockReset().mockResolvedValue({ data: [project], error: null })
  getLatestCrawlMock.mockReset().mockResolvedValue({ data: makeCrawl(), error: null })
  listCrawlPagesMock.mockReset().mockResolvedValue({ data: [home, service, blog], error: null })
})

describe('LocalAuditorPage', () => {
  it('prompts to create a project when there are none', async () => {
    listProjectsMock.mockResolvedValue({ data: [], error: null })
    renderPage('/page-auditor')
    expect(await screen.findByText('Create a project to audit its pages')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'New project' })).toHaveAttribute('href', '/projects/new')
  })

  it('shows a project-load error', async () => {
    listProjectsMock.mockResolvedValue({ data: null, error: 'Could not reach the server.' })
    renderPage('/page-auditor')
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not reach the server.')
  })

  it('asks the user to choose a project first', async () => {
    renderPage('/page-auditor')
    expect(await screen.findByText('Choose a project')).toBeInTheDocument()
    expect(getLatestCrawlMock).not.toHaveBeenCalled()
  })

  it('sends the user to the crawler when the project has never been crawled', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: null, error: null })
    renderPage()
    expect(await screen.findByText('Crawl this website first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Website Crawler' })).toHaveAttribute('href', `/crawler?project=${PROJECT_ID}`)
  })

  it('asks for a re-crawl when the crawl predates local signals', async () => {
    listCrawlPagesMock.mockResolvedValue({ data: [makeCrawlPage({ local_version: 0 })], error: null })
    renderPage()
    expect(await screen.findByText('Crawl again to collect local signals')).toBeInTheDocument()
    expect(screen.queryByText('Audit summary')).not.toBeInTheDocument()
  })

  it('explains a failed or running crawl instead of auditing', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: makeCrawl({ status: 'failed', error_message: 'Could not save.' }), error: null })
    renderPage()
    expect(await screen.findByText('The last crawl failed')).toBeInTheDocument()
    expect(screen.getByText(/Could not save\./)).toBeInTheDocument()
  })

  it('renders real audit numbers, top fixes, site checks and key pages only by default', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Audit summary' })).toBeInTheDocument()

    const summary = screen.getByRole('heading', { name: 'Audit summary' }).closest('section') as HTMLElement
    expect(within(summary).getByText('Pages audited').nextElementSibling).toHaveTextContent('3')

    const fixes = screen.getByRole('heading', { name: 'What to work on first' }).closest('section') as HTMLElement
    expect(within(fixes).getByText('Location in page title')).toBeInTheDocument()

    const site = screen.getByRole('list', { name: 'Site-wide checks' })
    expect(within(site).getByText('Home page found')).toBeInTheDocument()
    expect(within(site).getByText('Contact page exists')).toBeInTheDocument()

    const pages = screen.getByRole('list', { name: 'Audited pages' })
    expect(within(pages).getByText('acme.example/services/drains')).toBeInTheDocument()
    expect(within(pages).queryByText(/blog\/tips/)).not.toBeInTheDocument() // blog hidden under "key pages"
  })

  it('lets the user expand a page to read each check with its explanation', async () => {
    const user = userEvent.setup()
    renderPage()
    const pages = await screen.findByRole('list', { name: 'Audited pages' })
    await user.click(within(pages).getByText('acme.example/services/drains'))
    const checks = within(pages).getByRole('list', { name: 'Checks for https://acme.example/services/drains' })
    expect(within(checks).getByText('Location in page title')).toBeInTheDocument()
    expect(within(checks).getAllByText('Fix').length).toBeGreaterThan(0)
    expect(within(checks).getByText(/Add “Austin, TX” to the title/)).toBeInTheDocument()
  })

  it('filters pages: all pages includes the blog post, failures only hides clean pages', async () => {
    const user = userEvent.setup()
    renderPage()
    const select = await screen.findByLabelText('Filter pages')
    await user.selectOptions(select, 'all')
    expect(within(screen.getByRole('list', { name: 'Audited pages' })).getByText(/blog\/tips/)).toBeInTheDocument()

    await user.selectOptions(select, 'problems')
    const pages = screen.getByRole('list', { name: 'Audited pages' })
    expect(within(pages).getByText('acme.example/services/drains')).toBeInTheDocument()
    expect(within(pages).queryByText(/blog\/tips/)).not.toBeInTheDocument()
  })

  it('warns when the project has no location and skips location checks', async () => {
    listProjectsMock.mockResolvedValue({ data: [{ ...project, location: null, business_type: null, business_name: null }], error: null })
    renderPage()
    expect(await screen.findByText('This project has no primary location')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Add a location' })).toHaveAttribute('href', `/projects/${PROJECT_ID}/edit`)
    expect(screen.getByText(/No business name is set/)).toBeInTheDocument()
    expect(screen.queryByText('Location in page title')).not.toBeInTheDocument()
  })

  it('counts pages that were not audited', async () => {
    listCrawlPagesMock.mockResolvedValue({ data: [home, makeCrawlPage({ url: 'https://acme.example/gone', status_code: 404 })], error: null })
    renderPage()
    expect(await screen.findByText(/1 crawled page was not audited/)).toBeInTheDocument()
  })
})
