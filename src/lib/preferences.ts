/**
 * Small per-browser preferences (theme, last project). Storage can be blocked (private mode,
 * strict settings), so every access is wrapped and falls back to a default.
 */

export type ThemePreference = 'dark' | 'light' | 'system'

const THEME_KEY = 'lsw-theme'
const PROJECT_KEY = 'lsw-project'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // ignore: the preference just will not persist
  }
}

export function getThemePreference(): ThemePreference {
  const value = read(THEME_KEY)
  return value === 'light' || value === 'system' ? value : 'dark'
}

export function prefersDark(preference: ThemePreference): boolean {
  if (preference === 'system') {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return preference === 'dark'
}

/** Saves the preference and applies it to <html> immediately. */
export function setThemePreference(preference: ThemePreference): void {
  write(THEME_KEY, preference)
  applyTheme(preference)
}

export function applyTheme(preference: ThemePreference): void {
  const dark = prefersDark(preference)
  document.documentElement.classList.toggle('dark', dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0c1220' : '#f3f5f9')
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getLastProjectId(): string | null {
  const value = read(PROJECT_KEY)
  return value && UUID.test(value) ? value : null
}

export function setLastProjectId(id: string | null): void {
  write(PROJECT_KEY, id && UUID.test(id) ? id : null)
}

// ---- Subscribable stores (for useSyncExternalStore) -----------------------------------------

type Listener = () => void

function createStore<T>(initial: () => T) {
  let value: T | undefined
  const listeners = new Set<Listener>()
  return {
    get(): T {
      if (value === undefined) value = initial()
      return value
    },
    set(next: T) {
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

export const themeStore = createStore<ThemePreference>(getThemePreference)
export const lastProjectStore = createStore<string | null>(getLastProjectId)

export function chooseTheme(preference: ThemePreference): void {
  setThemePreference(preference)
  themeStore.set(preference)
}

export function rememberProject(id: string | null): void {
  setLastProjectId(id)
  lastProjectStore.set(id && UUID.test(id) ? id : null)
}
