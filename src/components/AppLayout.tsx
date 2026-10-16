import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useLastProjectId, useThemePreference } from '../hooks/usePreferences'
import { useProjectList } from '../hooks/useProjectList'
import { NAV_GROUPS, PROJECT_SCOPED_PATHS } from '../lib/navigation'
import { chooseTheme, rememberProject, type ThemePreference } from '../lib/preferences'
import type { ProjectRow } from '../types/database'
import { BrandMark } from './BrandMark'
import { CommandPalette } from './CommandPalette'
import { Icon, type IconName } from './icons'

// ---- Sidebar --------------------------------------------------------------------------------

function SidebarNav({ activeProjectId, onNavigate }: { activeProjectId: string | null; onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-6">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className="mt-5 first:mt-1">
          <h2 className="mb-1 px-2.5 text-xs font-medium text-ink-3">{group.label}</h2>
          <ul className="space-y-px">
            {group.items.map((item) => {
              const to = item.projectScoped && activeProjectId ? `${item.to}?project=${activeProjectId}` : item.to
              return (
                <li key={item.to}>
                  <NavLink
                    to={to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      [
                        'group relative flex items-center gap-3 rounded-lg px-2.5 py-[7px] text-sm transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent',
                        isActive ? 'bg-accent-soft font-medium text-ink' : 'text-ink-2 hover:bg-subtle hover:text-ink',
                      ].join(' ')
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive ? <span aria-hidden="true" className="absolute inset-y-1.5 left-0 w-[3px] rounded-full bg-accent" /> : null}
                        <Icon name={item.icon} className={`size-[18px] shrink-0 ${isActive ? 'text-accent-ink' : 'text-ink-3 group-hover:text-ink-2'}`} />
                        <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                      </>
                    )}
                  </NavLink>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </nav>
  )
}

// ---- Top bar pieces -------------------------------------------------------------------------

function ProjectSwitcher({
  projects,
  activeProjectId,
  onChange,
}: {
  projects: readonly ProjectRow[] | null
  activeProjectId: string | null
  onChange: (id: string | null) => void
}) {
  const active = projects?.find((project) => project.id === activeProjectId) ?? null
  return (
    <div className="relative min-w-0">
      <label htmlFor="global-project" className="sr-only">
        Client
      </label>
      <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 flex size-5 -translate-y-1/2 items-center justify-center rounded bg-accent text-[11px] font-semibold text-white">
        {active ? active.name.slice(0, 1).toUpperCase() : <Icon name="folder" className="size-3" />}
      </span>
      <select
        id="global-project"
        value={active?.id ?? ''}
        title={active ? `${active.name} (${active.website_url})` : undefined}
        onChange={(event) => onChange(event.target.value || null)}
        disabled={!projects}
        className="h-9 w-full max-w-[18rem] min-w-0 cursor-pointer appearance-none truncate rounded-lg border border-line bg-surface-2 pr-8 pl-10 text-sm font-medium text-ink hover:border-line-strong focus:outline-2 focus:outline-accent/40 sm:w-72"
      >
        <option value="">{projects && projects.length === 0 ? 'No clients yet' : 'Choose a client…'}</option>
        {projects?.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-ink-3" />
    </div>
  )
}

const THEME_ORDER: readonly ThemePreference[] = ['dark', 'light', 'system']
const THEME_META: Record<ThemePreference, { icon: IconName; label: string }> = {
  dark: { icon: 'moon', label: 'Dark theme' },
  light: { icon: 'sun', label: 'Light theme' },
  system: { icon: 'monitor', label: 'System theme' },
}

function ThemeButton() {
  const theme = useThemePreference()
  const next = THEME_ORDER[(THEME_ORDER.indexOf(theme) + 1) % THEME_ORDER.length] ?? 'dark'
  return (
    <button
      type="button"
      onClick={() => chooseTheme(next)}
      title={`${THEME_META[theme].label}. Switch to ${THEME_META[next].label.toLowerCase()}`}
      aria-label={`${THEME_META[theme].label}. Switch to ${THEME_META[next].label.toLowerCase()}`}
      className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
    >
      <Icon name={THEME_META[theme].icon} className="size-[18px]" />
    </button>
  )
}

function AccountMenu() {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onPointer(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleSignOut() {
    setBusy(true)
    setError(null)
    const { error: signOutError } = await signOut()
    setBusy(false)
    if (signOutError) setError(signOutError)
    else navigate('/sign-in', { replace: true })
  }

  const initial = (user?.email ?? '?').slice(0, 1).toUpperCase()
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-label="Account menu"
        className="flex size-9 items-center justify-center rounded-full bg-subtle text-sm font-semibold text-ink ring-1 ring-line hover:ring-line-strong focus-visible:outline-2 focus-visible:outline-accent"
      >
        {initial}
      </button>
      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-64 rounded-xl border border-line bg-surface p-2 shadow-xl">
          <div className="px-2.5 py-2">
            <p className="text-xs text-ink-3">Signed in as</p>
            <p className="truncate text-sm font-medium text-ink" title={user?.email ?? undefined}>
              {user?.email ?? 'Unknown user'}
            </p>
          </div>
          <div className="my-1 h-px bg-line-soft" />
          <NavLink to="/settings" onClick={() => setOpen(false)} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-ink-2 hover:bg-subtle hover:text-ink">
            <Icon name="settings" className="size-4" />
            Settings
          </NavLink>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={busy}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-ink-2 hover:bg-subtle hover:text-ink disabled:opacity-60"
          >
            <Icon name="logout" className="size-4" />
            {busy ? 'Signing out…' : 'Sign out'}
          </button>
          {error ? (
            <p role="alert" className="px-2.5 py-1 text-xs text-bad">
              {error}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

// ---- Layout ---------------------------------------------------------------------------------

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const projectsState = useProjectList()
  const lastProjectId = useLastProjectId()

  const urlProjectId = new URLSearchParams(location.search).get('project')
  const scoped = PROJECT_SCOPED_PATHS.has(location.pathname)
  const knownIds = projectsState.projects?.map((project) => project.id) ?? null
  const storedValid = lastProjectId && (knownIds === null || knownIds.includes(lastProjectId)) ? lastProjectId : null
  const activeProjectId = urlProjectId ?? storedValid

  // Remember the client chosen on any page, and open module pages on the last client used.
  useEffect(() => {
    if (urlProjectId) {
      rememberProject(urlProjectId)
    } else if (scoped && storedValid) {
      const params = new URLSearchParams(location.search)
      params.set('project', storedValid)
      navigate({ pathname: location.pathname, search: `?${params.toString()}` }, { replace: true })
    }
  }, [urlProjectId, scoped, storedValid, location.pathname, location.search, navigate])

  // Ctrl/⌘ + K opens the command menu.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen(true)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])

  function switchProject(id: string | null) {
    rememberProject(id)
    if (scoped) {
      const params = new URLSearchParams(location.search)
      if (id) params.set('project', id)
      else params.delete('project')
      navigate({ pathname: location.pathname, search: params.toString() ? `?${params.toString()}` : '' })
    } else if (id) {
      navigate(`/projects/${id}`)
    }
  }

  function closeDrawer() {
    setDrawerOpen(false)
    menuButtonRef.current?.focus()
  }

  useEffect(() => {
    if (!drawerOpen) return
    closeButtonRef.current?.focus()
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setDrawerOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  return (
    <div className="min-h-screen lg:pl-64 print:pl-0">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-accent-ink focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Persistent sidebar on desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-line bg-surface lg:flex print:hidden">
        <div className="flex h-16 items-center px-5">
          <BrandMark />
        </div>
        <SidebarNav activeProjectId={activeProjectId} />
        <div className="border-t border-line-soft px-5 py-3">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex w-full items-center justify-between rounded-lg text-xs text-ink-3 hover:text-ink-2"
          >
            <span>Quick jump</span>
            <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px]">Ctrl K</kbd>
          </button>
        </div>
      </aside>

      {/* Top bar */}
      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md sm:px-6 lg:px-10 print:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          className="rounded-lg p-2 text-ink-2 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent lg:hidden"
        >
          <Icon name="menu" />
        </button>
        <ProjectSwitcher projects={projectsState.projects} activeProjectId={activeProjectId} onChange={switchProject} />
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          className="hidden h-9 items-center gap-2 rounded-lg border border-line bg-surface-2 px-3 text-sm text-ink-3 hover:border-line-strong hover:text-ink-2 md:flex"
        >
          <Icon name="search" className="size-4" />
          <span className="pr-6">Jump to…</span>
          <kbd className="rounded border border-line px-1.5 py-0.5 text-[11px]">Ctrl K</kbd>
        </button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          aria-label="Open command menu"
          className="flex size-9 items-center justify-center rounded-lg text-ink-2 hover:bg-subtle md:hidden"
        >
          <Icon name="search" className="size-[18px]" />
        </button>
        <ThemeButton />
        <AccountMenu />
      </header>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={closeDrawer} className="absolute inset-0 bg-black/60" />
          <aside
            id="mobile-navigation"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 flex w-[85%] max-w-xs flex-col border-r border-line bg-surface shadow-xl"
          >
            <div className="flex h-16 items-center justify-between px-5">
              <BrandMark />
              <button
                ref={closeButtonRef}
                type="button"
                onClick={closeDrawer}
                aria-label="Close navigation menu"
                className="rounded-lg p-2 text-ink-2 hover:bg-subtle focus-visible:outline-2 focus-visible:outline-accent"
              >
                <Icon name="close" />
              </button>
            </div>
            <SidebarNav activeProjectId={activeProjectId} onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1} className="px-4 py-8 focus:outline-none sm:px-6 lg:px-10 lg:py-10 print:p-0">
        <div className="mx-auto max-w-7xl">
          <Outlet />
        </div>
      </main>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        projects={projectsState.projects ?? []}
        activeProjectId={activeProjectId}
      />
    </div>
  )
}
