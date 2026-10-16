import { useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { NAV_GROUPS } from '../lib/navigation'
import { BrandMark } from './BrandMark'
import { Icon } from './icons'
import { Button } from './ui/Button'

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { user, signOut } = useAuth()
  const navigate = useNavigate()
  const [signOutError, setSignOutError] = useState<string | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  async function handleSignOut() {
    setSigningOut(true)
    setSignOutError(null)
    const { error } = await signOut()
    setSigningOut(false)
    if (error) setSignOutError(error)
    else navigate('/sign-in', { replace: true })
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 py-5">
        <BrandMark />
      </div>

      <nav aria-label="Primary" className="flex-1 overflow-y-auto px-3 pb-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="mb-5">
            <h2 className="mb-1.5 px-2 text-xs font-semibold tracking-wide text-slate-500 uppercase">
              {group.label}
            </h2>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      [
                        'flex items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-indigo-600',
                        isActive
                          ? 'bg-indigo-50 text-indigo-700'
                          : 'text-slate-700 hover:bg-slate-100 hover:text-slate-900',
                      ].join(' ')
                    }
                  >
                    <Icon name={item.icon} className="size-5 shrink-0" />
                    <span className="min-w-0 flex-1 leading-snug">{item.label}</span>
                    {item.planned ? (
                      <span className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-slate-600 uppercase">
                        Planned
                      </span>
                    ) : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t border-slate-200 p-4">
        <p className="truncate text-xs text-slate-500">Signed in as</p>
        <p className="truncate text-sm font-medium text-slate-900" title={user?.email ?? undefined}>
          {user?.email ?? 'Unknown user'}
        </p>
        {signOutError ? (
          <p role="alert" className="mt-2 text-xs text-red-700">
            {signOutError}
          </p>
        ) : null}
        <Button
          variant="secondary"
          size="sm"
          className="mt-3 w-full"
          onClick={() => void handleSignOut()}
          loading={signingOut}
        >
          <Icon name="logout" className="size-4" />
          Sign out
        </Button>
      </div>
    </div>
  )
}

export function AppLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)

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
    <div className="min-h-screen lg:pl-72 print:pl-0">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-indigo-700 focus:shadow-lg"
      >
        Skip to main content
      </a>

      {/* Persistent sidebar on desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-72 border-r border-slate-200 bg-white lg:block print:hidden">
        <SidebarContent />
      </aside>

      {/* Top bar + drawer on tablet and mobile */}
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden print:hidden">
        <button
          ref={menuButtonRef}
          type="button"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open navigation"
          aria-expanded={drawerOpen}
          aria-controls="mobile-navigation"
          className="rounded-lg p-2 text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
        >
          <Icon name="menu" />
        </button>
        <BrandMark />
      </div>

      {drawerOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            aria-label="Close navigation"
            tabIndex={-1}
            onClick={closeDrawer}
            className="absolute inset-0 bg-slate-900/50"
          />
          <aside
            id="mobile-navigation"
            aria-label="Navigation"
            className="absolute inset-y-0 left-0 w-[85%] max-w-xs border-r border-slate-200 bg-white shadow-xl"
          >
            <button
              ref={closeButtonRef}
              type="button"
              onClick={closeDrawer}
              aria-label="Close navigation menu"
              className="absolute top-4 right-3 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-indigo-600"
            >
              <Icon name="close" />
            </button>
            <SidebarContent onNavigate={() => setDrawerOpen(false)} />
          </aside>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1} className="px-4 py-8 focus:outline-none sm:px-6 lg:px-10 print:p-0">
        <div className="mx-auto max-w-6xl">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
