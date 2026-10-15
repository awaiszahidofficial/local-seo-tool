import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ModulePage } from '../pages/ModulePage'
import { MODULE_IDS, MODULES } from '../lib/modules'

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/modules/:moduleId" element={<ModulePage />} />
        <Route path="/crawler" element={<h1>Crawler page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

// The crawler graduated from placeholder to a real page in Phase 2.
const PLACEHOLDER_IDS = MODULE_IDS.filter((id) => id !== 'crawler')

describe('ModulePage', () => {
  it('redirects the retired crawler placeholder to the real crawler page', () => {
    renderAt('/modules/crawler')
    expect(screen.getByRole('heading', { level: 1, name: 'Crawler page' })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
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
