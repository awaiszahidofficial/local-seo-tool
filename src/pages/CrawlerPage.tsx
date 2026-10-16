import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ISSUE_META, isIssueCode, sortIssues } from '../../supabase/functions/_shared/issues.ts'
import { Icon } from '../components/icons'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { StatusBadge, type BadgeTone } from '../components/ui/StatusBadge'
import { Table, Td, Th } from '../components/ui/Table'
import { controlClasses } from '../components/ui/fieldStyles'
import { useLatestCrawl } from '../hooks/useLatestCrawl'
import { useProjectList } from '../hooks/useProjectList'
import { formatPageLimit } from '../../supabase/functions/_shared/limits.ts'
import { describeStopReason, filterPages, startCrawl, summarizeCrawl, type IssueFilter } from '../lib/crawls'
import { formatDateTime } from '../lib/format'
import { formatUrlForDisplay, getSafeHttpUrl } from '../lib/url'
import type { CrawlPageRow } from '../types/database'

const SEVERITY_TONE: Record<'error' | 'warning' | 'info', BadgeTone> = {
  error: 'danger',
  warning: 'warning',
  info: 'neutral',
}

/** Rows rendered at first; "Show more" adds this many again (1,000-row tables are slow to scroll). */
const ROWS_STEP = 100

const FILTER_LABELS: Record<IssueFilter, string> = {
  all: 'All pages',
  errors: 'Pages with errors',
  warnings: 'Pages with warnings only',
  clean: 'No errors or warnings',
}

function IssueBadges({ issues }: { issues: string[] }) {
  const sorted = sortIssues(issues)
  if (sorted.length === 0) return <span className="text-ink-3">No issues</span>
  return (
    <ul className="flex flex-wrap gap-1">
      {sorted.map((code) => (
        <li key={code}>
          <StatusBadge tone={SEVERITY_TONE[ISSUE_META[code].severity]}>{ISSUE_META[code].label}</StatusBadge>
        </li>
      ))}
    </ul>
  )
}

function statusTone(code: number | null): BadgeTone {
  if (code === null || code >= 400) return 'danger'
  if (code >= 300) return 'warning'
  return 'success'
}

function PageRow({ page, startUrl }: { page: CrawlPageRow; startUrl: string }) {
  const href = getSafeHttpUrl(page.url)
  return (
    <tr>
      <Td className="max-w-xs">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent-ink hover:underline">
            {formatUrlForDisplay(page.url, 60)}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          <span className="break-all">{page.url}</span>
        )}
        {page.url === startUrl ? <span className="ml-2 text-xs text-ink-3">(start page)</span> : null}
        {page.final_url ? (
          <p className="mt-0.5 text-xs break-all text-ink-3">Redirects to {formatUrlForDisplay(page.final_url, 60)}</p>
        ) : null}
      </Td>
      <Td>
        {page.status_code === null ? (
          <StatusBadge tone="danger">Failed</StatusBadge>
        ) : (
          <StatusBadge tone={statusTone(page.status_code)}>{String(page.status_code)}</StatusBadge>
        )}
      </Td>
      <Td className="max-w-xs">
        {page.title ?? <span className="text-ink-3">{page.error ?? 'Missing'}</span>}
      </Td>
      <Td className="max-w-[14rem]">{page.h1 ?? <span className="text-ink-3">—</span>}</Td>
      <Td className="text-right tabular-nums">{page.error ? '—' : page.word_count}</Td>
      <Td>
        <IssueBadges issues={page.issues} />
      </Td>
    </tr>
  )
}

export function CrawlerPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const requestedId = searchParams.get('project')
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === requestedId) ?? null
  const crawlState = useLatestCrawl(selected?.id ?? null, { light: true })

  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [justFinished, setJustFinished] = useState<number | null>(null)
  const [filter, setFilter] = useState<IssueFilter>('all')
  const [progress, setProgress] = useState<number | null>(null)
  const [rowLimit, setRowLimit] = useState(ROWS_STEP)

  const summary = useMemo(() => summarizeCrawl(crawlState.pages), [crawlState.pages])
  const visiblePages = useMemo(() => filterPages(crawlState.pages, filter), [crawlState.pages, filter])

  async function handleStart(resumeCrawlId?: string) {
    if (!selected || running) return
    setRunning(true)
    setRunError(null)
    setJustFinished(null)
    setProgress(null)
    const result = await startCrawl(selected.id, {
      ...(resumeCrawlId ? { crawlId: resumeCrawlId } : {}),
      onProgress: ({ pagesCrawled }) => setProgress(pagesCrawled),
    })
    setRunning(false)
    setProgress(null)
    if (result.data === null) {
      setRunError(result.error)
      crawlState.reload()
      return
    }
    setJustFinished(result.data.pagesCrawled)
    setFilter('all')
    setRowLimit(ROWS_STEP)
    crawlState.reload()
  }

  const header = (
    <PageHeader
      title="Website Crawler"
      description="Crawl a project’s website to list its pages and find on-page issues: missing titles, meta descriptions and headings, duplicate titles, thin content and broken pages."
    />
  )

  if (projectsState.loading) {
    return (
      <>
        {header}
        <LoadingState label="Loading your projects…" />
      </>
    )
  }
  if (projectsState.error) {
    return (
      <>
        {header}
        <Alert variant="error" title="Could not load your projects">
          {projectsState.error}
        </Alert>
      </>
    )
  }
  if (!projects || projects.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="globe"
            title="Create a project to crawl its website"
            description="The crawler works on the website address saved in a project."
            action={<ButtonLink to="/projects/new">New project</ButtonLink>}
          />
        </Card>
      </>
    )
  }

  const crawl = crawlState.crawl
  const stopNote = crawl ? describeStopReason(crawl.stopped_reason) : null

  return (
    <>
      {header}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="crawl-project"
            projects={projects}
            value={selected?.id ?? ''}
            disabled={running}
            onChange={(projectId) => {
              setRunError(null)
              setJustFinished(null)
              setFilter('all')
              setRowLimit(ROWS_STEP)
              const next = new URLSearchParams(searchParams)
              if (projectId) next.set('project', projectId)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
          <Button onClick={() => void handleStart()} loading={running} disabled={!selected}>
            <Icon name="globe" className="size-4" />
            {running ? 'Crawling…' : crawl ? 'Crawl again' : 'Start crawl'}
          </Button>
        </div>
        <p className="border-t border-line-soft px-5 py-3 text-xs text-ink-2">
          Crawls up to {formatPageLimit()} pages of this one website, follows links on the same site only, and
          respects robots.txt. Small sites take about a minute; large sites can take several minutes.
        </p>
      </Card>

      {running ? (
        <Alert variant="info" className="mb-6" title="Crawl in progress">
          Fetching pages from {selected ? formatUrlForDisplay(selected.website_url, 60) : 'the site'}
          {progress !== null ? ` · ${progress.toLocaleString('en-US')} pages so far` : ''}. Keep this page open until it
          finishes. Large sites are crawled in parts of about a minute each.
        </Alert>
      ) : null}
      {runError ? (
        <Alert variant="error" className="mb-6" title="The crawl did not complete">
          {runError}
        </Alert>
      ) : null}
      {justFinished !== null && !runError ? (
        <Alert variant="success" className="mb-6">
          Crawl finished: {justFinished} {justFinished === 1 ? 'page' : 'pages'} checked.
        </Alert>
      ) : null}

      {!selected ? (
        <Card>
          <EmptyState
            icon="globe"
            title="Choose a project"
            description="Pick a project above, then start a crawl to see its pages and issues."
          />
        </Card>
      ) : crawlState.loading ? (
        <LoadingState label="Loading crawl results…" />
      ) : crawlState.error ? (
        <Alert variant="error" title="Could not load crawl results">
          {crawlState.error}{' '}
          {crawlState.error.includes('migration') ? null : (
            <>
              If this is a new setup, make sure the <code>20261016000000_crawls.sql</code> migration has been applied.
            </>
          )}
        </Alert>
      ) : !crawl ? (
        <Card>
          <EmptyState
            icon="globe"
            title="This website has not been crawled yet"
            description="Start a crawl to list the site’s pages and check each one for common on-page SEO problems."
          />
        </Card>
      ) : (
        <div className="space-y-6">
          <Card as="section" aria-labelledby="crawl-summary">
            <CardHeader
              id="crawl-summary"
              title="Latest crawl"
              description={`${formatDateTime(crawl.started_at)} · ${formatUrlForDisplay(crawl.start_url, 60)}`}
              action={
                <StatusBadge
                  tone={crawl.status === 'completed' ? 'success' : crawl.status === 'failed' ? 'danger' : 'warning'}
                >
                  {crawl.status === 'completed' ? 'Completed' : crawl.status === 'failed' ? 'Failed' : 'Running'}
                </StatusBadge>
              }
            />
            {crawl.status === 'failed' ? (
              <div className="p-5">
                <Alert variant="error" title="This crawl failed">
                  {crawl.error_message ?? 'Something went wrong. Try crawling again.'}
                </Alert>
              </div>
            ) : crawl.status === 'running' ? (
              <div className="p-5">
                {running ? (
                  <Alert variant="info">This crawl is in progress.</Alert>
                ) : (
                  <Alert variant="info" title="This crawl did not finish">
                    {crawl.pages_crawled.toLocaleString('en-US')} pages were saved before it stopped (for example, the
                    page was closed). Resume it to continue where it left off. If it is still running in another
                    tab, resuming waits for that tab.
                    <div className="mt-3">
                      <Button onClick={() => void handleStart(crawl.id)} disabled={running}>
                        Resume crawl
                      </Button>
                    </div>
                  </Alert>
                )}
              </div>
            ) : (
              <>
                <dl className="grid grid-cols-2 gap-px bg-subtle sm:grid-cols-4">
                  {[
                    ['Pages crawled', summary.totalPages],
                    ['Pages with errors', summary.pagesWithErrors],
                    ['Pages with warnings', summary.pagesWithWarnings],
                    ['No errors or warnings', summary.cleanPages],
                  ].map(([label, value]) => (
                    <div key={label} className="bg-surface px-5 py-4">
                      <dt className="text-xs font-medium text-ink-2">{label}</dt>
                      <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
                {stopNote ? (
                  <div className="p-5 pb-0">
                    <Alert variant="warning">{stopNote}</Alert>
                  </div>
                ) : null}
              </>
            )}
          </Card>

          {crawl.status === 'completed' && summary.issueCounts.length > 0 ? (
            <Card as="section" aria-labelledby="issue-breakdown">
              <CardHeader id="issue-breakdown" title="Issues found" description="Counted by number of pages affected." />
              <ul className="divide-y divide-line-soft">
                {summary.issueCounts.map((entry) => (
                  <li key={entry.code} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <span className="flex items-center gap-3">
                      <StatusBadge tone={SEVERITY_TONE[entry.severity]}>
                        {entry.severity === 'error' ? 'Error' : entry.severity === 'warning' ? 'Warning' : 'Notice'}
                      </StatusBadge>
                      <span className="text-ink">{isIssueCode(entry.code) ? ISSUE_META[entry.code].label : entry.code}</span>
                    </span>
                    <span className="font-medium text-ink tabular-nums">
                      {entry.count} {entry.count === 1 ? 'page' : 'pages'}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {crawl.status === 'completed' ? (
            <Card as="section" aria-labelledby="crawl-pages">
              <CardHeader
                id="crawl-pages"
                title="Pages"
                action={
                  <div className="flex items-center gap-2">
                    <label htmlFor="page-filter" className="sr-only">
                      Filter pages
                    </label>
                    <select
                      id="page-filter"
                      className={controlClasses(false)}
                      value={filter}
                      onChange={(event) => {
                        setFilter(event.target.value as IssueFilter)
                        setRowLimit(ROWS_STEP)
                      }}
                    >
                      {(Object.keys(FILTER_LABELS) as IssueFilter[]).map((value) => (
                        <option key={value} value={value}>
                          {FILTER_LABELS[value]}
                        </option>
                      ))}
                    </select>
                  </div>
                }
              />
              {crawlState.pages.length === 0 ? (
                <EmptyState
                  icon="alert"
                  title="No pages were recorded"
                  description={stopNote ?? 'The crawl finished without finding any pages to record.'}
                />
              ) : visiblePages.length === 0 ? (
                <p className="px-5 py-8 text-center text-sm text-ink-2">No pages match this filter.</p>
              ) : (
                <Table aria-label="Crawled pages">
                  <thead>
                    <tr>
                      <Th>Page</Th>
                      <Th>Status</Th>
                      <Th>Title</Th>
                      <Th>H1</Th>
                      <Th className="text-right">Words</Th>
                      <Th>Issues</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {visiblePages.slice(0, rowLimit).map((page) => (
                      <PageRow key={page.id} page={page} startUrl={crawl.start_url} />
                    ))}
                  </tbody>
                </Table>
              )}
              {visiblePages.length > rowLimit ? (
                <div className="flex items-center justify-between gap-4 border-t border-line-soft px-5 py-3 text-sm">
                  <span className="text-ink-2">
                    Showing {rowLimit.toLocaleString('en-US')} of {visiblePages.length.toLocaleString('en-US')} pages
                  </span>
                  <Button variant="secondary" onClick={() => setRowLimit((value) => value + ROWS_STEP * 2)}>
                    Show more
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          <p className="text-xs text-ink-3">
            Results describe the pages as fetched without running JavaScript. Pages that depend on scripts to show
            their content may look thinner here than in a browser.{' '}
            <Link to={`/projects/${selected.id}`} className="font-medium text-accent-ink hover:underline">
              View project
            </Link>
          </p>
        </div>
      )}
    </>
  )
}
