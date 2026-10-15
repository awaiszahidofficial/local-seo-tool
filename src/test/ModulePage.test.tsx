import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ModulePage } from '../pages/ModulePage'
import { MODULE_IDS, MODULES, getImplementedPath } from '../lib/modules'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/modules/:moduleId" element={<ModulePage />} />
        <Route path="/crawler" element={<h1>Crawler page</h1>} />
        <Route path="/page-auditor" element={<h1>Auditor page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

// Built modules (Phase 2 crawler, Phase 3 auditor) have real pages; the rest are placeholders.
const PLACEHOLDER_IDS = MODULE_IDS.filter((id) => getImplementedPath(id) === null)

describe('ModulePage', () => {
  it('redirects retired placeholders of built modules to their real pages', () => {
    renderAt('/modules/crawler')
    expect(screen.getByRole('heading', { level: 1, name: 'Crawler page' })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
  })

  it('redirects the page-auditor placeholder to the auditor page', () => {
    renderAt('/modules/page-auditor')
    expect(screen.getByRole('heading', { level: 1, name: 'Auditor page' })).toBeInTheDocument()
  })

  it('keeps placeholders for every module that is not built yet', () => {
    expect(PLACEHOLDER_IDS).toEqual(['service-area', 'gbp-audit', 'search-console', 'listings', 'keywords', 'recommendations', 'reports'])
  })

  it.each(PLACEHOLDER_IDS)('renders the %s placeholder with the correct name and a not-implemented notice', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: MODULES[id].name })).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText('Not implemented in this phase')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/projects')
  })

  it('does not render any action buttons for planned modules', () => {
    renderAt('/modules/reports')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['unknown-module', 'constructor', '__proto__'])('shows a safe fallback for invalid id "%s"', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Module not found' })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toBeInTheDocument()
  })
})
