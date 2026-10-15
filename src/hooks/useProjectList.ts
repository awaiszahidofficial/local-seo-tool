import { useCallback, useEffect, useState } from 'react'
import { listProjects } from '../lib/projects'
import type { ProjectRow } from '../types/database'

type Loaded = { key: number; projects: ProjectRow[] | null; error: string | null }

export function useProjectList() {
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<Loaded | null>(null)

  useEffect(() => {
    let cancelled = false
    void listProjects().then((response) => {
      if (!cancelled) {
        setResult({ key: reloadKey, projects: response.data, error: response.error })
      }
    })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const current = result !== null && result.key === reloadKey ? result : null
  const reload = useCallback(() => setReloadKey((key) => key + 1), [])

  return {
    loading: current === null,
    projects: current?.projects ?? null,
    error: current?.error ?? null,
    reload,
  }
}
