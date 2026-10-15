import { useEffect, useState } from 'react'
import { getProject } from '../lib/projects'
import type { ProjectRow } from '../types/database'

type Loaded = { id: string; project: ProjectRow | null; error: string | null }

export function useProject(id: string | undefined) {
  const [result, setResult] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    void getProject(id).then((response) => {
      if (!cancelled) setResult({ id, project: response.data, error: response.error })
    })
    return () => {
      cancelled = true
    }
  }, [id])

  if (!id) return { loading: false, project: null, error: null, notFound: true }

  const current = result !== null && result.id === id ? result : null
  if (current === null) return { loading: true, project: null, error: null, notFound: false }

  return {
    loading: false,
    project: current.project,
    error: current.error,
    notFound: current.error === null && current.project === null,
  }
}
