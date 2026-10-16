import { useCallback, useEffect, useState } from 'react'
import { getLatestCrawl, listCrawlPages } from '../lib/crawls'
import type { CrawlPageRow, CrawlRow } from '../types/database'

type Loaded = {
  key: string
  crawl: CrawlRow | null
  pages: CrawlPageRow[]
  error: string | null
}

/**
 * Loads the latest crawl (and its pages) for a project; `reload` refetches after a new crawl.
 * `light` skips the long page text (the crawler table does not show it).
 */
export function useLatestCrawl(projectId: string | null, options: { light?: boolean } = {}) {
  const light = options.light === true
  const [reloadKey, setReloadKey] = useState(0)
  const [result, setResult] = useState<Loaded | null>(null)
  const key = `${projectId ?? ''}:${reloadKey}`

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      const crawlResult = await getLatestCrawl(projectId)
      if (cancelled) return
      if (crawlResult.error || !crawlResult.data) {
        setResult({ key, crawl: null, pages: [], error: crawlResult.error })
        return
      }
      const pagesResult = await listCrawlPages(crawlResult.data.id, light ? { light } : undefined)
      if (cancelled) return
      setResult({
        key,
        crawl: crawlResult.data,
        pages: pagesResult.data ?? [],
        error: pagesResult.error,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, key, light])

  const reload = useCallback(() => setReloadKey((value) => value + 1), [])

  if (!projectId) return { loading: false, crawl: null, pages: [], error: null, reload }
  const current = result !== null && result.key === key ? result : null
  if (current === null) return { loading: true, crawl: null, pages: [], error: null, reload }
  return { loading: false, crawl: current.crawl, pages: current.pages, error: current.error, reload }
}
