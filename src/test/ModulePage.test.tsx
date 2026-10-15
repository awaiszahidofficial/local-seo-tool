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
      </Routes>
    </MemoryRouter>,
  )
}

describe('ModulePage', () => {
  it.each(MODULE_IDS)('renders the %s placeholder with the correct name and a not-implemented notice', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: MODULES[id].name })).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
    expect(screen.getByText('Not implemented in this phase')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: 'Go to projects' })).toHaveAttribute('href', '/projects')
  })

  it('does not render any action buttons for planned modules', () => {
    renderAt('/modules/crawler')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each(['unknown-module', 'constructor', '__proto__'])('shows a safe fallback for invalid id "%s"', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Module not found' })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toBeInTheDocument()
  })
})
