import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  listProjects: vi.fn(),
  getLatestCrawl: vi.fn(),
  listCrawlPages: vi.fn(),
  getGbpProfile: vi.fn(),
  listListings: vi.fn(),
  saveListing: vi.fn(),
  deleteListing: vi.fn(),
  getGscStatus: vi.fn(),
  getGscPerformance: vi.fn(),
  listRecommendationStates: vi.fn(),
  setRecommendationState: vi.fn(),
  listReports: vi.fn(),
  saveReport: vi.fn(),
  getReport: vi.fn(),
  deleteReport: vi.fn(),
}))

vi.mock('../lib/projects', async (orig) => ({ ...(await orig<typeof import('../lib/projects')>()), listProjects: m.listProjects }))
vi.mock('../lib/crawls', async (orig) => ({
  ...(await orig<typeof import('../lib/crawls')>()),
  getLatestCrawl: m.getLatestCrawl,
  listCrawlPages: m.listCrawlPages,
}))
vi.mock('../lib/gbp', async (orig) => ({ ...(await orig<typeof import('../lib/gbp')>()), getGbpProfile: m.getGbpProfile }))
vi.mock('../lib/listings', async (orig) => ({
  ...(await orig<typeof import('../lib/listings')>()),
  listListings: m.listListings,
  saveListing: m.saveListing,
  deleteListing: m.deleteListing,
}))
vi.mock('../lib/searchConsole', async (orig) => ({
  ...(await orig<typeof import('../lib/searchConsole')>()),
  getGscStatus: m.getGscStatus,
  getGscPerformance: m.getGscPerformance,
}))
vi.mock('../lib/recommendationStates', () => ({
  listRecommendationStates: m.listRecommendationStates,
  setRecommendationState: m.setRecommendationState,
}))
vi.mock('../lib/reportSnapshot', async (orig) => ({
  ...(await orig<typeof import('../lib/reportSnapshot')>()),
  listReports: m.listReports,
  saveReport: m.saveReport,
  getReport: m.getReport,
  deleteReport: m.deleteReport,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { KeywordsPage } from '../pages/KeywordsPage'
import { ListingsPage } from '../pages/ListingsPage'
import { RecommendationsPage } from '../pages/RecommendationsPage'
import { ReportViewPage } from '../pages/ReportViewPage'
import { ReportsPage } from '../pages/ReportsPage'
import { PROJECT_ID, makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Rodeo Blinds',
  business_name: 'Rodeo Blinds',
  location: 'Austin, TX',
  service_areas: ['Austin, TX', 'Round Rock, TX'],
  services: ['Window blinds'],
})

const pages = [
  makeCrawlPage({ url: 'https://acme.example/', title: 'Rodeo Blinds', h1: 'Blinds and shutters', link_paths: ['/window-blinds-austin'] }),
  makeCrawlPage({ url: 'https://acme.example/window-blinds-austin', title: 'Window Blinds in Austin', h1: 'Window blinds Austin', word_count: 600 }),
]

function renderAt(entry: string) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/listings" element={<ListingsPage />} />
        <Route path="/keywords" element={<KeywordsPage />} />
        <Route path="/recommendations" element={<RecommendationsPage />} />
        <Route path="/reports" element={<ReportsPage />} />
        <Route path="/reports/:reportId" element={<ReportViewPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const mock of Object.values(m)) mock.mockReset()
  m.listProjects.mockResolvedValue({ data: [project], error: null })
  m.getLatestCrawl.mockResolvedValue({ data: makeCrawl(), error: null })
  m.listCrawlPages.mockResolvedValue({ data: pages, error: null })
  m.getGbpProfile.mockResolvedValue({ data: null, error: null })
  m.listListings.mockResolvedValue({ data: [], error: null })
  m.getGscStatus.mockResolvedValue({ data: { connected: false, email: null }, error: null, code: null })
  m.listRecommendationStates.mockResolvedValue({ data: [], error: null })
  m.listReports.mockResolvedValue({ data: [], error: null })
})

describe('ListingsPage', () => {
  it('shows the reference details, the missing essentials, and adds a listing', async () => {
    const user = userEvent.setup()
    m.saveListing.mockResolvedValue({ data: { id: 'x' }, error: null })
    renderAt(`/listings?project=${PROJECT_ID}`)
    expect(await screen.findByRole('heading', { name: 'Correct business details' })).toBeInTheDocument()
    const missing = screen.getByRole('list', { name: 'Missing essential directories' })
    await user.click(within(missing).getByRole('button', { name: '+ Yelp' }))
    expect(screen.getByLabelText('Directory')).toHaveValue('Yelp')
    await user.click(screen.getByRole('button', { name: 'Fill in the correct details' }))
    expect(screen.getByLabelText('Name on the listing')).toHaveValue('Rodeo Blinds')
    await user.click(screen.getByRole('button', { name: 'Add listing' }))
    expect(m.saveListing).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({ directory: 'Yelp', name: 'Rodeo Blinds' }), undefined)
    await waitFor(() => expect(m.listListings).toHaveBeenCalledTimes(2))
  })

  it('marks listings that differ from the correct details', async () => {
    m.getGbpProfile.mockResolvedValue({ data: { business_name: 'Rodeo Blinds', phone: '512-555-0142', address: null, website_url: null }, error: null })
    m.listListings.mockResolvedValue({
      data: [
        { id: '00000000-0000-4000-8000-0000000000aa', project_id: PROJECT_ID, user_id: 'u', directory: 'Yelp', listing_url: null, status: 'live', name: 'Rodeo Blinds', address: null, phone: '512-555-9999', website: null, notes: null, last_checked: null, created_at: '', updated_at: '' },
      ],
      error: null,
    })
    renderAt(`/listings?project=${PROJECT_ID}`)
    const table = await screen.findByRole('table', { name: 'Listings' })
    expect(within(table).getByText('Phone differs')).toBeInTheDocument()
    expect(within(table).getByText('Name matches')).toBeInTheDocument()
  })
})

describe('KeywordsPage', () => {
  it('lists keywords with the matching page and the next step', async () => {
    renderAt(`/keywords?project=${PROJECT_ID}`)
    const table = await screen.findByRole('table', { name: 'Keyword opportunities' })
    const austin = within(table).getByText('window blinds austin').closest('tr') as HTMLElement
    expect(within(austin).getByText(/window-blinds-austin/)).toBeInTheDocument()
    const roundRock = within(table).getByText('window blinds round rock').closest('tr') as HTMLElement
    expect(within(roundRock).getByText('Create a page')).toBeInTheDocument()
    expect(screen.getByText(/Without Search Console/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Download CSV' })).toBeInTheDocument()
  })
})

describe('RecommendationsPage', () => {
  it('lists recommendations and moves one to Done', async () => {
    const user = userEvent.setup()
    m.setRecommendationState.mockResolvedValue({ data: { key: 'k' }, error: null })
    renderAt(`/recommendations?project=${PROJECT_ID}`)
    const list = await screen.findByRole('list', { name: 'Recommendations' })
    expect(within(list).getByText('Create a page for Round Rock')).toBeInTheDocument()
    await user.click(within(list).getByRole('button', { name: 'Mark “Create a page for Round Rock” as done' }))
    expect(m.setRecommendationState).toHaveBeenCalledWith(PROJECT_ID, 'coverage:page:round-rock-tx', 'done')
    await waitFor(() => expect(within(screen.getByRole('list', { name: 'Recommendations' })).queryByText('Create a page for Round Rock')).not.toBeInTheDocument())
    await user.click(screen.getByRole('tab', { name: /Done \(1\)/ }))
    expect(screen.getByText('Create a page for Round Rock')).toBeInTheDocument()
  })
})

describe('Reports', () => {
  it('creates a report from a snapshot and opens it', async () => {
    const user = userEvent.setup()
    let saved: unknown = null
    m.saveReport.mockImplementation(async (_projectId: string, title: string, snapshot: unknown) => {
      saved = snapshot
      return { data: { id: '11111111-1111-4111-8111-111111111111', project_id: PROJECT_ID, title, created_at: '2026-10-17T00:00:00Z' }, error: null }
    })
    m.getReport.mockImplementation(async () => ({
      data: { id: '11111111-1111-4111-8111-111111111111', project_id: PROJECT_ID, user_id: 'u', title: 'October report', snapshot: saved, created_at: '' },
      error: null,
    }))
    renderAt(`/reports?project=${PROJECT_ID}`)
    expect(await screen.findByText('No reports yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create report' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'October report' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Service-area coverage' })).toBeInTheDocument()
    expect(screen.getByText('50% of service areas have a dedicated page.')).toBeInTheDocument()
    expect(screen.getByText(/Search Console was not connected/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Print or save as PDF' })).toBeInTheDocument()
  })

  it('shows not found for a missing report', async () => {
    m.getReport.mockResolvedValue({ data: null, error: null })
    renderAt('/reports/11111111-1111-4111-8111-111111111111')
    expect(await screen.findByText('Report not found')).toBeInTheDocument()
  })
})
