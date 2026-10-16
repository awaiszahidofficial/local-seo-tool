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
        {MODULE_IDS.map((id) => (
          <Route key={id} path={getImplementedPath(id) ?? `/unused/${id}`} element={<h1>{`${MODULES[id].name} page`}</h1>} />
        ))}
      </Routes>
    </MemoryRouter>,
  )
}

describe('ModulePage', () => {
  it('has a built page for every module', () => {
    expect(MODULE_IDS.filter((id) => getImplementedPath(id) === null)).toEqual([])
  })

  it.each(MODULE_IDS)('redirects the old /modules/%s address to the real page', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: `${MODULES[id].name} page` })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
  })

  it.each(['unknown-module', 'constructor', '__proto__'])('shows a safe fallback for invalid id "%s"', (id) => {
    renderAt(`/modules/${id}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Module not found' })).toBeInTheDocument()
    expect(screen.queryByText('Not implemented in this phase')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to overview' })).toBeInTheDocument()
  })
})
