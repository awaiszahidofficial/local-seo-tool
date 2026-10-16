import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listProjects: vi.fn(),
  updateGscProperty: vi.fn(),
  getGscStatus: vi.fn(),
  listGscSites: vi.fn(),
  getGscPerformance: vi.fn(),
  disconnectGsc: vi.fn(),
  startGscConnect: vi.fn(),
  finishGscConnect: vi.fn(),
  takeReturnPath: vi.fn(),
}))

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  listProjects: mocks.listProjects,
  updateGscProperty: mocks.updateGscProperty,
}))
vi.mock('../lib/searchConsole', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/searchConsole')>()),
  getGscStatus: mocks.getGscStatus,
  listGscSites: mocks.listGscSites,
  getGscPerformance: mocks.getGscPerformance,
  disconnectGsc: mocks.disconnectGsc,
  startGscConnect: mocks.startGscConnect,
  finishGscConnect: mocks.finishGscConnect,
  takeReturnPath: mocks.takeReturnPath,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { SearchConsoleCallbackPage } from '../pages/SearchConsoleCallbackPage'
import { SearchConsolePage } from '../pages/SearchConsolePage'
import { PROJECT_ID, makeProject } from './crawlFixtures'

const ok = <T,>(data: T) => ({ data, error: null, code: null })
const fail = (error: string, code: string | null = null) => ({ data: null, error, code })

const project = makeProject({
  name: 'Rodeo Blinds',
  website_url: 'https://rodeoblinds.com',
  location: 'Austin, TX',
  service_areas: ['Austin, TX'],
  gsc_property: null,
})

const row = (key: string, clicks: number, impressions: number, position: number) => ({ key, clicks, impressions, ctr: clicks / impressions, position })

const performance = {
  property: 'sc-domain:rodeoblinds.com',
  ranges: { current: { startDate: '2026-09-17', endDate: '2026-10-14' }, previous: { startDate: '2026-08-20', endDate: '2026-09-16' } },
  totals: { current: { clicks: 120, impressions: 4000, ctr: 0.03, position: 11.2 }, previous: { clicks: 100, impressions: 3500, ctr: 0.028, position: 12 } },
  queries: {
    current: [row('blinds austin', 40, 900, 3.1), row('roller shades', 6, 800, 9.5), row('shutters near me', 3, 120, 14)],
    previous: [row('blinds austin', 30, 800, 4)],
  },
  pages: { current: [row('https://rodeoblinds.com/', 80, 2000, 6)], previous: [] },
}

function renderPage(entry = `/search-console?project=${PROJECT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route path="/search-console" element={<SearchConsolePage />} />
        <Route path="/search-console/callback" element={<SearchConsoleCallbackPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset()
  mocks.listProjects.mockResolvedValue({ data: [project], error: null })
  mocks.getGscStatus.mockResolvedValue(ok({ connected: true, email: 'seo@example.com' }))
  mocks.listGscSites.mockResolvedValue(ok({ sites: [{ siteUrl: 'https://www.other.com/', permissionLevel: 'siteOwner' }, { siteUrl: 'sc-domain:rodeoblinds.com', permissionLevel: 'siteOwner' }] }))
  mocks.getGscPerformance.mockResolvedValue(ok(performance))
})

describe('SearchConsolePage', () => {
  it('explains when Google is not configured on the server', async () => {
    mocks.getGscStatus.mockResolvedValue(fail('Google is not set up yet. Add GOOGLE_CLIENT_ID…', 'not_configured'))
    renderPage()
    expect(await screen.findByText('Google is not set up yet')).toBeInTheDocument()
    expect(mocks.listGscSites).not.toHaveBeenCalled()
  })

  it('offers to connect when not connected, and starts the Google sign-in', async () => {
    const user = userEvent.setup()
    mocks.getGscStatus.mockResolvedValue(ok({ connected: false, email: null }))
    mocks.startGscConnect.mockResolvedValue(fail('Blocked for the test'))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Connect Google Search Console' }))
    expect(mocks.startGscConnect).toHaveBeenCalledWith(`/search-console?project=${PROJECT_ID}`)
    expect(await screen.findByText('Blocked for the test')).toBeInTheDocument()
  })

  it('suggests the matching property and saves it for the project', async () => {
    const user = userEvent.setup()
    mocks.updateGscProperty.mockResolvedValue({ data: { ...project, gsc_property: 'sc-domain:rodeoblinds.com' }, error: null })
    renderPage()
    expect(await screen.findByText(/Connected as seo@example\.com/)).toBeInTheDocument()
    const select = await screen.findByLabelText('Search Console property for Rodeo Blinds')
    expect(select).toHaveValue('sc-domain:rodeoblinds.com')
    await user.click(screen.getByRole('button', { name: 'Use this property' }))
    expect(mocks.updateGscProperty).toHaveBeenCalledWith(PROJECT_ID, 'sc-domain:rodeoblinds.com')
    expect(await screen.findByRole('heading', { name: 'Search performance' })).toBeInTheDocument()
    expect(mocks.getGscPerformance).toHaveBeenCalledWith(PROJECT_ID, 28)
  })

  it('shows totals, local searches, striking-distance queries and pages', async () => {
    mocks.listProjects.mockResolvedValue({ data: [{ ...project, gsc_property: 'sc-domain:rodeoblinds.com' }], error: null })
    renderPage()
    const totals = (await screen.findByRole('heading', { name: 'Search performance' })).closest('section') as HTMLElement
    expect(within(totals).getByText('120')).toBeInTheDocument()
    expect(within(totals).getByText('+20.0%')).toBeInTheDocument()

    const local = screen.getByRole('table', { name: 'Local queries' })
    expect(within(local).getByText('blinds austin')).toBeInTheDocument()
    expect(within(local).getByText('shutters near me')).toBeInTheDocument()
    expect(within(local).queryByText('roller shades')).not.toBeInTheDocument()

    const striking = screen.getByRole('table', { name: 'Striking-distance queries' })
    expect(within(striking).getByText('roller shades')).toBeInTheDocument()
    expect(within(striking).queryByText('blinds austin')).not.toBeInTheDocument()

    expect(within(screen.getByRole('table', { name: 'Top pages' })).getByText(/rodeoblinds\.com/)).toBeInTheDocument()
  })

  it('reloads for a different period', async () => {
    const user = userEvent.setup()
    mocks.listProjects.mockResolvedValue({ data: [{ ...project, gsc_property: 'sc-domain:rodeoblinds.com' }], error: null })
    renderPage()
    await screen.findByRole('heading', { name: 'Search performance' })
    await user.selectOptions(screen.getByLabelText('Period'), '90')
    await waitFor(() => expect(mocks.getGscPerformance).toHaveBeenCalledWith(PROJECT_ID, 90))
  })

  it('asks to reconnect when Google says the connection expired', async () => {
    mocks.listProjects.mockResolvedValue({ data: [{ ...project, gsc_property: 'sc-domain:rodeoblinds.com' }], error: null })
    mocks.getGscPerformance.mockResolvedValue(fail('Your Google connection has expired. Connect Google again.', 'reconnect'))
    renderPage()
    expect(await screen.findByRole('button', { name: 'Connect Google again' })).toBeInTheDocument()
  })

  it('disconnects', async () => {
    const user = userEvent.setup()
    mocks.disconnectGsc.mockResolvedValue(ok({ connected: false }))
    renderPage()
    await user.click(await screen.findByRole('button', { name: 'Disconnect' }))
    mocks.getGscStatus.mockResolvedValue(ok({ connected: false, email: null }))
    expect(mocks.disconnectGsc).toHaveBeenCalled()
  })
})

describe('SearchConsoleCallbackPage', () => {
  it('finishes the sign-in once and returns to Search Console with a notice', async () => {
    mocks.finishGscConnect.mockResolvedValue(ok({ connected: true, email: 'seo@example.com' }))
    mocks.takeReturnPath.mockReturnValue('/search-console')
    mocks.getGscStatus.mockResolvedValue(ok({ connected: true, email: 'seo@example.com' }))
    renderPage('/search-console/callback?code=abc1234567&state=xyz')
    expect(await screen.findByText('Google Search Console connected (seo@example.com).')).toBeInTheDocument()
    expect(mocks.finishGscConnect).toHaveBeenCalledTimes(1)
    const params = mocks.finishGscConnect.mock.calls[0]?.[0] as URLSearchParams
    expect(params.get('code')).toBe('abc1234567')
  })

  it('shows why the connection failed', async () => {
    mocks.finishGscConnect.mockResolvedValue(fail('This sign-in link is not valid or has expired. Start again from Search Console.'))
    renderPage('/search-console/callback?code=abc&state=wrong')
    expect(await screen.findByText(/not valid or has expired/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Search Console' })).toHaveAttribute('href', '/search-console')
  })
})
