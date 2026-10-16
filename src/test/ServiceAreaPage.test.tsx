import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listProjectsMock, updateCoverageListsMock, getLatestCrawlMock, listCrawlPagesMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  updateCoverageListsMock: vi.fn(),
  getLatestCrawlMock: vi.fn(),
  listCrawlPagesMock: vi.fn(),
}))

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  listProjects: listProjectsMock,
  updateCoverageLists: updateCoverageListsMock,
}))
vi.mock('../lib/crawls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/crawls')>()),
  getLatestCrawl: getLatestCrawlMock,
  listCrawlPages: listCrawlPagesMock,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { ServiceAreaPage } from '../pages/ServiceAreaPage'
import { PROJECT_ID, makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
  service_areas: ['Austin, TX', 'Georgetown, TX'],
  services: [],
})

const longText = (city: string) => `${city} plumber. Plumbing in ${city}. ${Array.from({ length: 400 }, (_, i) => `w${i}`).join(' ')}`

const pages = [
  makeCrawlPage({ url: 'https://acme.example/', title: 'Acme Plumbing', link_paths: ['/service-areas/austin'] }),
  makeCrawlPage({
    url: 'https://acme.example/service-areas/austin',
    title: 'Plumber in Austin, TX',
    h1: 'Austin plumber',
    word_count: 500,
    body_text: longText('Austin'),
  }),
  makeCrawlPage({ url: 'https://acme.example/locations/hutto', title: 'Hutto', h1: 'Hutto', body_text: longText('Hutto') }),
]

function renderPage(entry = `/service-area?project=${PROJECT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ServiceAreaPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listProjectsMock.mockReset().mockResolvedValue({ data: [project], error: null })
  updateCoverageListsMock.mockReset()
  getLatestCrawlMock.mockReset().mockResolvedValue({ data: makeCrawl(), error: null })
  listCrawlPagesMock.mockReset().mockResolvedValue({ data: pages, error: null })
})

describe('ServiceAreaPage', () => {
  it('prompts to create a project when there are none', async () => {
    listProjectsMock.mockResolvedValue({ data: [], error: null })
    renderPage('/service-area')
    expect(await screen.findByText('Create a project to check its service areas')).toBeInTheDocument()
  })

  it('asks to choose a project', async () => {
    renderPage('/service-area')
    expect(await screen.findByText('Choose a project')).toBeInTheDocument()
    expect(getLatestCrawlMock).not.toHaveBeenCalled()
  })

  it('sends the user to the crawler when the site has not been crawled', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: null, error: null })
    renderPage()
    expect(await screen.findByText('Crawl this website first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to Website Crawler' })).toHaveAttribute('href', `/crawler?project=${PROJECT_ID}`)
  })

  it('shows coverage, the area table, the services grid and the next page to create', async () => {
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Coverage summary' })).toBeInTheDocument()
    expect(screen.getByText('50% of your service areas have a dedicated page.')).toBeInTheDocument()

    const table = screen.getByRole('table', { name: 'Service area coverage' })
    const austinRow = within(table).getByText('Austin, TX').closest('tr') as HTMLElement
    expect(within(austinRow).getByText('Covered')).toBeInTheDocument()
    const georgetownRow = within(table).getByText('Georgetown, TX').closest('tr') as HTMLElement
    expect(within(georgetownRow).getByText('No content')).toBeInTheDocument()

    const next = screen.getByRole('heading', { name: 'Pages to create next' }).closest('section') as HTMLElement
    expect(within(next).getByText('Plumber in Georgetown, TX')).toBeInTheDocument()
    expect(within(next).getByText('/service-areas/georgetown/')).toBeInTheDocument()

    expect(screen.getByRole('table', { name: 'Services by area' })).toBeInTheDocument()
  })

  it('suggests areas the site already has pages for, and saves the edited lists', async () => {
    const user = userEvent.setup()
    updateCoverageListsMock.mockImplementation(async (_id: string, lists: { service_areas: string[]; services: string[] }) => ({
      data: { ...project, ...lists, updated_at: '2026-10-17T00:00:00Z' },
      error: null,
    }))
    renderPage()
    await screen.findByRole('heading', { name: 'Coverage summary' })

    const saveButton = screen.getByRole('button', { name: 'Save lists' })
    expect(saveButton).toBeDisabled()

    await user.click(screen.getByRole('button', { name: '+ Hutto' }))
    await user.type(screen.getByLabelText('Services'), 'Drain cleaning')
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    expect(updateCoverageListsMock).toHaveBeenCalledWith(PROJECT_ID, {
      service_areas: ['Austin, TX', 'Georgetown, TX', 'Hutto'],
      services: ['Drain cleaning'],
    })
    expect(await screen.findByText(/Saved\. The results below are updated\./)).toBeInTheDocument()
    const table = screen.getByRole('table', { name: 'Service area coverage' })
    await waitFor(() => expect(within(table).getByText('Hutto')).toBeInTheDocument())
  })

  it('shows a save error, such as the missing migration', async () => {
    const user = userEvent.setup()
    updateCoverageListsMock.mockResolvedValue({ data: null, error: 'Run the 20261019000000_service_areas.sql migration in Supabase.' })
    renderPage()
    await screen.findByRole('heading', { name: 'Coverage summary' })
    await user.type(screen.getByLabelText('Service areas'), '\nHutto')
    await user.click(screen.getByRole('button', { name: 'Save lists' }))
    expect(await screen.findByText(/20261019000000_service_areas\.sql/)).toBeInTheDocument()
  })

  it('falls back to the primary location when no areas are saved', async () => {
    listProjectsMock.mockResolvedValue({ data: [{ ...project, service_areas: [] }], error: null })
    renderPage()
    expect(await screen.findByText(/only the project’s primary location “Austin, TX” is checked/)).toBeInTheDocument()
  })

  it('asks for areas when there is neither a list nor a location', async () => {
    listProjectsMock.mockResolvedValue({ data: [{ ...project, service_areas: [], location: null }], error: null })
    renderPage()
    expect(await screen.findByText('Add the areas this business serves')).toBeInTheDocument()
  })

  it('explains when the last crawl is still running', async () => {
    getLatestCrawlMock.mockResolvedValue({ data: makeCrawl({ status: 'running' }), error: null })
    renderPage()
    expect(await screen.findByText('A crawl is still running')).toBeInTheDocument()
  })
})
