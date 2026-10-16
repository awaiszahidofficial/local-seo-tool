import { useCallback, useEffect, useState } from 'react'

type Loaded<T> = { key: string; value: T }

/**
 * Runs `load` whenever `key` changes (null = do nothing) and returns its latest result.
 * `reload` runs it again for the same key. Results for an outdated key are ignored.
 */
export function useLoad<T>(key: string | null, load: () => Promise<T>) {
  const [version, setVersion] = useState(0)
  const [state, setState] = useState<Loaded<T> | null>(null)
  const fullKey = key === null ? null : `${key}#${version}`

  useEffect(() => {
    if (fullKey === null) return
    let cancelled = false
    void load().then((value) => {
      if (!cancelled) setState({ key: fullKey, value })
    })
    return () => {
      cancelled = true
    }
    // `load` is recreated on every render; `fullKey` captures what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullKey])

  const reload = useCallback(() => setVersion((value) => value + 1), [])
  const current = fullKey !== null && state?.key === fullKey ? state.value : null
  // While reloading, keep showing the previous value for the same base key.
  const stale = current === null && state !== null && key !== null && state.key.startsWith(`${key}#`) ? state.value : null
  return { loading: fullKey !== null && current === null, value: current ?? stale, reload }
}
