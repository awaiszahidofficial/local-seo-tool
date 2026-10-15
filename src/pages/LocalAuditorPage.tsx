import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { StatusBadge, type BadgeTone } from '../components/ui/StatusBadge'
import { controlClasses } from '../components/ui/fieldStyles'
import { useLatestCrawl } from '../hooks/useLatestCrawl'
import { useProjectList } from '../hooks/useProjectList'
import { formatDateTime } from '../lib/format'
import {
  KEY_PAGE_TYPES,
  PAGE_TYPE_LABELS,
  auditSite,
  needsRecrawl,
  type AuditCheck,
  type CheckStatus,
  type PageAudit,
} from '../lib/localAudit'
import { formatUrlForDisplay } from '../lib/url'

type PageFilter = 'key' | 'all' | 'problems'

const FILTER_LABELS: Record<PageFilter, string> = {
  key: 'Key pages (home, contact, service, location)',
  all: 'All audited pages',
  problems: 'Pages with failures',
}

const STATUS_BADGE: Record<CheckStatus, { tone: BadgeTone; label: string }> = {
  pass: { tone: 'success', label: 'Pass' },
  warn: { tone: 'warning', label: 'Improve' },
  fail: { tone: 'danger', label: 'Fix' },
  info: { tone: 'planned', label: 'Note' },
}

function CheckList({ checks, label }: { checks: readonly AuditCheck[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-slate-100">
      {checks.map((check) => (
        <li key={check.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
          <span className="w-20 shrink-0">
            <StatusBadge tone={STATUS_BADGE[check.status].tone}>{STATUS_BADGE[check.status].label}</StatusBadge>
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-900">{check.label}</p>
            <p className="mt-0.5 break-words text-slate-600">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function PageSummary({ audit }: { audit: PageAudit }) {
  const parts: string[] = []
  if (audit.failed > 0) parts.push(`${audit.failed} to fix`)
  if (audit.warnings > 0) parts.push(`${audit.warnings} to improve`)
  if (parts.length === 0) parts.push('All checks passed')
  return <>{parts.join(' · ')}</>
}

function PageAuditItem({ audit }: { audit: PageAudit }) {
  const tone: BadgeTone = audit.failed > 0 ? 'danger' : audit.warnings > 0 ? 'warning' : 'success'
  return (
    <li className="border-b border-slate-100 last:border-b-0">
      <details className="group">
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600">
          <Icon name="arrowLeft" className="size-4 shrink-0 -rotate-90 text-slate-500 transition-transform group-open:rotate-90" />
          <span className="min-w-0 flex-1 break-all font-medium text-slate-900">{formatUrlForDisplay(audit.url, 70)}</span>
          <StatusBadge tone="neutral">{PAGE_TYPE_LABELS[audit.type]}</StatusBadge>
          <StatusBadge tone={tone}>{audit.checks.length === 0 ? 'No local checks' : `${audit.passed} of ${audit.checks.length} passed`}</StatusBadge>
          <span className="text-xs text-slate-600">
            <PageSummary audit={audit} />
          </span>
        </summary>
        {audit.checks.length === 0 ? (
          <p className="px-5 pb-4 text-sm text-slate-600">
            No local checks apply to this type of page. The auditor focuses on home, contact, service and location pages.
          </p>
        ) : (
          <CheckList checks={audit.checks} label={`Checks for ${audit.url}`} />
        )}
      </details>
    </li>
  )
}

export function LocalAuditorPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const requestedId = searchParams.get('project')
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === requestedId) ?? null
  const crawlState = useLatestCrawl(selected?.id ?? null)
  const [filter, setFilter] = useState<PageFilter>('key')

  const crawl = crawlState.crawl
  const stale = needsRecrawl(crawlState.pages)
  const audit = useMemo(
    () => (selected && crawl?.status === 'completed' && !stale ? auditSite(selected, crawlState.pages) : null),
    [selected, crawl, stale, crawlState.pages],
  )
  const visiblePages = useMemo(() => {
    if (!audit) return []
    if (filter === 'all') return audit.pages
    if (filter === 'problems') return audit.pages.filter((page) => page.failed > 0)
    return audit.pages.filter((page) => KEY_PAGE_TYPES.includes(page.type))
  }, [audit, filter])

  const header = (
    <PageHeader
      title="Local Page Auditor"
      description="Check a project’s crawled pages for the signals that matter in local search: location in titles and headings, phone and address, structured data, contact links and content depth."
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
            icon="file-check"
            title="Create a project to audit its pages"
            description="The auditor uses the website, location and business type saved in a project."
            action={<ButtonLink to="/projects/new">New project</ButtonLink>}
          />
        </Card>
      </>
    )
  }

  const crawlLink = selected ? `/crawler?project=${selected.id}` : '/crawler'

  return (
    <>
      {header}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="audit-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(projectId) => {
              setFilter('key')
              const next = new URLSearchParams(searchParams)
              if (projectId) next.set('project', projectId)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
          {selected ? (
            <ButtonLink to={crawlLink} variant="secondary">
              <Icon name="globe" className="size-4" />
              Crawl again
            </ButtonLink>
          ) : null}
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
          The audit runs on the most recent crawl of the project, so crawl the site first and again after making changes.
        </p>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="file-check" title="Choose a project" description="Pick a project above to audit its latest crawl." />
        </Card>
      ) : crawlState.loading ? (
        <LoadingState label="Loading the latest crawl…" />
      ) : crawlState.error ? (
        <Alert variant="error" title="Could not load crawl data">
          {crawlState.error}
        </Alert>
      ) : !crawl ? (
        <Card>
          <EmptyState
            icon="globe"
            title="Crawl this website first"
            description="The auditor reads pages collected by the Website Crawler. Run a crawl for this project, then come back."
            action={<ButtonLink to={crawlLink}>Go to Website Crawler</ButtonLink>}
          />
        </Card>
      ) : crawl.status !== 'completed' ? (
        <Alert variant={crawl.status === 'failed' ? 'error' : 'info'} title={crawl.status === 'failed' ? 'The last crawl failed' : 'A crawl is still running'}>
          {crawl.status === 'failed'
            ? (crawl.error_message ?? 'Run the crawl again to get audit results.')
            : 'Wait for it to finish, then reload this page.'}{' '}
          <Link to={crawlLink} className="font-medium underline">
            Open the Website Crawler
          </Link>
        </Alert>
      ) : stale ? (
        <Alert variant="warning" title="Crawl again to collect local signals">
          This crawl was made before the Local Page Auditor existed, so it did not store phone numbers, structured data or
          page text.{' '}
          <Link to={crawlLink} className="font-medium underline">
            Crawl {selected.name} again
          </Link>
          .
        </Alert>
      ) : audit ? (
        <div className="space-y-6">
          {audit.context.cityTerms.length === 0 ? (
            <Alert variant="warning" title="This project has no primary location">
              Location checks were skipped. <Link to={`/projects/${selected.id}/edit`} className="font-medium underline">Add a location</Link>{' '}
              such as “Austin, TX” to audit titles, headings and content for local relevance.
            </Alert>
          ) : null}
          {audit.context.typeStems.length === 0 ? (
            <Alert variant="info">
              No usable business type is set, so the service-keyword check was skipped.{' '}
              <Link to={`/projects/${selected.id}/edit`} className="font-medium underline">Add a business type</Link> such as “Plumber”.
            </Alert>
          ) : null}
          {audit.context.brandIsProjectName ? (
            <Alert variant="info">
              No business name is set, so the project name “{audit.context.brand}” is used for brand checks.
            </Alert>
          ) : null}

          <Card as="section" aria-labelledby="audit-summary">
            <CardHeader
              id="audit-summary"
              title="Audit summary"
              description={`Based on the crawl from ${formatDateTime(crawl.started_at)} of ${formatUrlForDisplay(crawl.start_url, 60)}`}
            />
            <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-4">
              {(
                [
                  ['Pages audited', audit.pages.length],
                  ['Checks passed', audit.totals.passed],
                  ['To improve', audit.totals.warnings],
                  ['To fix', audit.totals.failed],
                ] as const
              ).map(([label, value]) => (
                <div key={label} className="bg-white px-5 py-4">
                  <dt className="text-xs font-medium text-slate-600">{label}</dt>
                  <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {audit.skippedPages > 0 ? (
              <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
                {audit.skippedPages} crawled {audit.skippedPages === 1 ? 'page was' : 'pages were'} not audited because they failed to load or redirected.
              </p>
            ) : null}
          </Card>

          {audit.topFixes.length > 0 ? (
            <Card as="section" aria-labelledby="top-fixes">
              <CardHeader id="top-fixes" title="What to work on first" description="Problems ranked by severity, then by how many pages they affect." />
              <ol className="divide-y divide-slate-100">
                {audit.topFixes.slice(0, 8).map((fix) => (
                  <li key={fix.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <span className="flex items-center gap-3">
                      <StatusBadge tone={fix.status === 'fail' ? 'danger' : 'warning'}>{fix.status === 'fail' ? 'Fix' : 'Improve'}</StatusBadge>
                      <span className="text-slate-800">{fix.label}</span>
                    </span>
                    <span className="shrink-0 text-slate-700 tabular-nums">
                      {fix.pages} {fix.pages === 1 ? 'page' : 'pages'}
                    </span>
                  </li>
                ))}
              </ol>
            </Card>
          ) : (
            <Alert variant="success">Every check passed on the audited pages.</Alert>
          )}

          <Card as="section" aria-labelledby="site-checks">
            <CardHeader id="site-checks" title="Site-wide checks" description="Consistency of the business details across the whole site." />
            <CheckList checks={audit.siteChecks} label="Site-wide checks" />
          </Card>

          <Card as="section" aria-labelledby="page-audits">
            <CardHeader
              id="page-audits"
              title="Page-by-page results"
              description="Open a page to see each check and what to change."
              action={
                <>
                  <label htmlFor="audit-filter" className="sr-only">
                    Filter pages
                  </label>
                  <select
                    id="audit-filter"
                    className={controlClasses(false)}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value as PageFilter)}
                  >
                    {(Object.keys(FILTER_LABELS) as PageFilter[]).map((value) => (
                      <option key={value} value={value}>
                        {FILTER_LABELS[value]}
                      </option>
                    ))}
                  </select>
                </>
              }
            />
            {visiblePages.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-slate-600">No pages match this filter.</p>
            ) : (
              <ul aria-label="Audited pages">
                {visiblePages.map((page) => (
                  <PageAuditItem key={page.pageId} audit={page} />
                ))}
              </ul>
            )}
          </Card>

          <p className="text-xs text-slate-500">
            Checks read each page as served without running JavaScript, and use the first 12,000 characters of
            each page’s main content. They are best-practice guidelines, not a ranking guarantee. Phone numbers are detected from page
            text and tel: links; address detection relies on an &lt;address&gt; element or structured data.
          </p>
        </div>
      ) : null}
    </>
  )
}
