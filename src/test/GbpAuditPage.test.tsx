import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GbpProfileRow } from '../types/database'

const { listProjectsMock, getGbpProfileMock, saveGbpProfileMock, getLatestCrawlMock, listCrawlPagesMock } = vi.hoisted(() => ({
  listProjectsMock: vi.fn(),
  getGbpProfileMock: vi.fn(),
  saveGbpProfileMock: vi.fn(),
  getLatestCrawlMock: vi.fn(),
  listCrawlPagesMock: vi.fn(),
}))

vi.mock('../lib/projects', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/projects')>()),
  listProjects: listProjectsMock,
}))
vi.mock('../lib/gbp', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/gbp')>()),
  getGbpProfile: getGbpProfileMock,
  saveGbpProfile: saveGbpProfileMock,
}))
vi.mock('../lib/crawls', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/crawls')>()),
  getLatestCrawl: getLatestCrawlMock,
  listCrawlPages: listCrawlPagesMock,
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

import { GbpAuditPage } from '../pages/GbpAuditPage'
import { PROJECT_ID, makeCrawl, makeCrawlPage, makeProject } from './crawlFixtures'

const project = makeProject({
  name: 'Acme',
  business_name: 'Acme Plumbing',
  location: 'Austin, TX',
  business_type: 'Plumber',
  website_url: 'https://acme.example',
  services: ['Drain cleaning'],
})

const savedProfile: GbpProfileRow = {
  project_id: PROJECT_ID,
  user_id: project.user_id,
  verified: true,
  business_name: 'Acme Plumbing',
  primary_category: 'Plumber',
  additional_categories: [],
  phone: '(512) 555-9999',
  website_url: 'https://acme.example',
  address: null,
  service_area_business: false,
  gbp_service_areas: [],
  has_hours: true,
  has_special_hours: null,
  description: null,
  services: ['Drain cleaning'],
  products_count: null,
  photos_count: 3,
  has_logo: true,
  has_cover_photo: null,
  review_count: 4,
  rating: 4.9,
  reviews_last_90_days: null,
  reply_rate: null,
  last_post_date: null,
  attributes_count: null,
  has_booking_link: null,
  created_at: '2026-10-16T10:00:00Z',
  updated_at: '2026-10-16T10:00:00Z',
}

function renderPage(entry = `/gbp-audit?project=${PROJECT_ID}`) {
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <GbpAuditPage />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  listProjectsMock.mockReset().mockResolvedValue({ data: [project], error: null })
  getGbpProfileMock.mockReset().mockResolvedValue({ data: null, error: null })
  saveGbpProfileMock.mockReset()
  getLatestCrawlMock.mockReset().mockResolvedValue({ data: makeCrawl(), error: null })
  listCrawlPagesMock.mockReset().mockResolvedValue({
    data: [makeCrawlPage({ url: 'https://acme.example/', phones: ['512-555-0142'] })],
    error: null,
  })
})

describe('GbpAuditPage', () => {
  it('prompts to create a project when there are none', async () => {
    listProjectsMock.mockResolvedValue({ data: [], error: null })
    renderPage('/gbp-audit')
    expect(await screen.findByText('Create a project to audit its Business Profile')).toBeInTheDocument()
  })

  it('asks to choose a project', async () => {
    renderPage('/gbp-audit')
    expect(await screen.findByText('Choose a project')).toBeInTheDocument()
    expect(getGbpProfileMock).not.toHaveBeenCalled()
  })

  it('shows an empty form with a shortcut to start from the project details', async () => {
    const user = userEvent.setup()
    renderPage()
    expect(await screen.findByText('No profile details yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Start from project details' }))
    expect(screen.getByLabelText('Business name on the profile')).toHaveValue('Acme Plumbing')
    expect(screen.getByLabelText('Primary category')).toHaveValue('Plumber')
    expect(screen.getByLabelText('Website link')).toHaveValue('https://acme.example')
  })

  it('audits a saved profile, including the phone mismatch with the website', async () => {
    getGbpProfileMock.mockResolvedValue({ data: savedProfile, error: null })
    renderPage()
    expect(await screen.findByRole('heading', { name: 'Profile score' })).toBeInTheDocument()
    const fixes = screen.getByRole('list', { name: 'Top fixes' })
    expect(within(fixes).getByText('Number of reviews')).toBeInTheDocument()
    expect(within(fixes).getByText('Same phone number as the website')).toBeInTheDocument()
    expect(screen.getByText(/Still to fill in:/)).toBeInTheDocument()
  })

  it('validates before saving and does not call the server with bad values', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('No profile details yet')
    await user.type(screen.getByLabelText('Average rating'), '7')
    await user.click(screen.getByRole('button', { name: 'Save and audit' }))
    expect(await screen.findByText('Rating must be a number from 1.0 to 5.0.')).toBeInTheDocument()
    expect(saveGbpProfileMock).not.toHaveBeenCalled()
  })

  it('saves the details and shows the audit', async () => {
    const user = userEvent.setup()
    saveGbpProfileMock.mockImplementation(async (projectId: string, input: Partial<GbpProfileRow>) => ({
      data: { ...savedProfile, ...input, project_id: projectId },
      error: null,
    }))
    renderPage()
    await screen.findByText('No profile details yet')
    await user.selectOptions(screen.getByLabelText('Profile is verified'), 'yes')
    await user.type(screen.getByLabelText('Total reviews'), '40')
    await user.click(screen.getByRole('button', { name: 'Save and audit' }))

    expect(saveGbpProfileMock).toHaveBeenCalledWith(PROJECT_ID, expect.objectContaining({ verified: true, review_count: 40 }))
    expect(await screen.findByRole('heading', { name: 'Profile score' })).toBeInTheDocument()
    expect(screen.getByText('Saved. The audit above is updated.')).toBeInTheDocument()
  })

  it('shows the migration message when the table is missing', async () => {
    getGbpProfileMock.mockResolvedValue({ data: null, error: 'Run the 20261020000000_gbp_profiles.sql migration in Supabase.' })
    renderPage()
    expect(await screen.findByText(/20261020000000_gbp_profiles\.sql/)).toBeInTheDocument()
  })
})
