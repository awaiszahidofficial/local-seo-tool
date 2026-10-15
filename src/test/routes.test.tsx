import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { ProtectedRoute } from '../components/ProtectedRoute'
import { PublicOnlyRoute } from '../components/PublicOnlyRoute'
import { AuthContext, type AuthContextValue } from '../contexts/auth-context'
import { makeAuthValue, makeUser } from './authValue'

function LocationProbe() {
  const location = useLocation()
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>
}

function renderRoutes(auth: AuthContextValue, initialEntry: string | { pathname: string; state: unknown }) {
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route element={<PublicOnlyRoute />}>
            <Route path="/sign-in" element={<h1>Sign in page</h1>} />
          </Route>
          <Route path="/reset-password" element={<h1>Reset password page</h1>} />
          <Route element={<ProtectedRoute />}>
            <Route index element={<h1>Dashboard</h1>} />
            <Route path="projects" element={<h1>Projects page</h1>} />
          </Route>
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </AuthContext.Provider>,
  )
}

describe('ProtectedRoute', () => {
  it('shows a loading state while the session is being read', () => {
    renderRoutes(makeAuthValue({ loading: true }), '/projects')
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('redirects signed-out visitors to sign-in', () => {
    renderRoutes(makeAuthValue(), '/projects')
    expect(screen.getByRole('heading', { name: 'Sign in page' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/sign-in')
  })

  it('renders the protected page for signed-in users', () => {
    renderRoutes(makeAuthValue({ user: makeUser() }), '/projects')
    expect(screen.getByRole('heading', { name: 'Projects page' })).toBeInTheDocument()
  })

  it('sends users in a password-recovery session to the reset page', () => {
    renderRoutes(makeAuthValue({ user: makeUser(), isRecovery: true }), '/projects')
    expect(screen.getByRole('heading', { name: 'Reset password page' })).toBeInTheDocument()
  })
})

describe('PublicOnlyRoute', () => {
  it('shows the public page to signed-out visitors', () => {
    renderRoutes(makeAuthValue(), '/sign-in')
    expect(screen.getByRole('heading', { name: 'Sign in page' })).toBeInTheDocument()
  })

  it('shows a loading state while the session is being read', () => {
    renderRoutes(makeAuthValue({ loading: true }), '/sign-in')
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
  })

  it('redirects signed-in users away to the dashboard', () => {
    renderRoutes(makeAuthValue({ user: makeUser() }), '/sign-in')
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getByTestId('location')).toHaveTextContent('/')
  })

  it('returns signed-in users to the page they originally requested', () => {
    renderRoutes(makeAuthValue({ user: makeUser() }), {
      pathname: '/sign-in',
      state: { from: { pathname: '/projects', search: '' } },
    })
    expect(screen.getByRole('heading', { name: 'Projects page' })).toBeInTheDocument()
  })

  it('ignores unsafe redirect targets', () => {
    renderRoutes(makeAuthValue({ user: makeUser() }), {
      pathname: '/sign-in',
      state: { from: { pathname: '//evil.example', search: '' } },
    })
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument()
  })

  it('sends recovery sessions to the reset page instead of the app', () => {
    renderRoutes(makeAuthValue({ user: makeUser(), isRecovery: true }), '/sign-in')
    expect(screen.getByRole('heading', { name: 'Reset password page' })).toBeInTheDocument()
  })
})
