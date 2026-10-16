import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { useLoad } from '../hooks/useLoad'
import { useProjectList } from '../hooks/useProjectList'
import {
  ACTION_LABELS,
  DEFAULT_PATTERNS,
  PATTERN_LABELS,
  STATUS_LABELS,
  buildKeywordReport,
  downloadText,
  keywordsToCsv,
  type KeywordAction,
  type KeywordPattern,
  type KeywordStatus,
} from '../lib/keywords'
import { slugify } from '../lib/serviceArea'
import { getGscPerformance, getGscStatus } from '../lib/searchConsole'
import { formatUrlForDisplay, getSafeHttpUrl } from '../lib/url'

const STATUS_TONE: Record<KeywordStatus, BadgeTone> = {
  top3: 'success',
  page1: 'success',
  striking: 'warning',
  low: 'danger',
  no_data: 'danger',
  unknown: 'planned',
}

const ACTION_TONE: Record<KeywordAction, BadgeTone> = {
  create_page: 'danger',
  improve_page: 'warning',
  push_top: 'neutral',
  keep: 'success',
}

type ActionFilter = 'all' | KeywordAction

const integer = new Intl.NumberFormat('en-US')
const ALL_PATTERNS = Object.keys(PATTERN_LABELS) as KeywordPattern[]

export function KeywordsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === searchParams.get('project')) ?? null
  const crawlState = useLatestCrawl(selected?.id ?? null, { light: true })

  const status = useLoad('gsc-status', getGscStatus)
  const connected = status.value?.data?.connected === true
  const gscKey = selected && connected && selected.gsc_property ? `${selected.id}:${selected.gsc_property}` : null
  const gsc = useLoad(gscKey, () => getGscPerformance(selected?.id ?? '', 90))

  const [patterns, setPatterns] = useState<KeywordPattern[]>([...DEFAULT_PATTERNS])
  const [filter, setFilter] = useState<ActionFilter>('all')
  const [limit, setLimit] = useState(50)

  const crawlReady = crawlState.crawl?.status === 'completed'
  const gscQueries = gscKey === null ? null : (gsc.value?.data?.queries.current ?? null)
  const report = useMemo(
    () => (selected && !crawlState.loading && !status.loading && (gscKey === null || !gsc.loading) ? buildKeywordReport(selected, crawlReady ? crawlState.pages : [], gscQueries, patterns) : null),
    [selected, crawlState.loading, status.loading, crawlState.pages, crawlReady, gscKey, gsc.loading, gscQueries, patterns],
  )
  const visible = useMemo(() => (report ? report.rows.filter((row) => filter === 'all' || row.action === filter) : []), [report, filter])

  const header = (
    <PageHeader
      title="Keyword Opportunities"
      description="The searches local customers make for each service in each area, whether the site has a page for them, and how they perform in Google."
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
  if (projectsState.error || !projects) {
    return (
      <>
        {header}
        <Alert variant="error" title="Could not load your projects">
          {projectsState.error}
        </Alert>
      </>
    )
  }
  if (projects.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon="trending" title="Create a project first" description="Keywords are built from a project’s services and areas." action={<ButtonLink to="/projects/new">New project</ButtonLink>} />
        </Card>
      </>
    )
  }

  return (
    <>
      {header}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="keywords-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(id) => {
              setFilter('all')
              setLimit(50)
              const next = new URLSearchParams(searchParams)
              if (id) next.set('project', id)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
          {report && report.rows.length > 0 && selected ? (
            <Button variant="secondary" onClick={() => downloadText(`keywords-${slugify(selected.name) || 'project'}.csv`, keywordsToCsv(report.rows))}>
              Download CSV
            </Button>
          ) : null}
        </div>
        <fieldset className="border-t border-line-soft px-5 py-3">
          <legend className="sr-only">Keyword patterns</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink-2">
            {ALL_PATTERNS.map((pattern) => (
              <label key={pattern} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 rounded border-line-strong text-accent-ink"
                  checked={patterns.includes(pattern)}
                  onChange={(event) =>
                    setPatterns((current) =>
                      event.target.checked ? ALL_PATTERNS.filter((item) => item === pattern || current.includes(item)) : current.filter((item) => item !== pattern),
                    )
                  }
                />
                {PATTERN_LABELS[pattern]}
              </label>
            ))}
          </div>
        </fieldset>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="trending" title="Choose a project" description="Pick a project above to see its keyword opportunities." />
        </Card>
      ) : !report ? (
        <LoadingState label="Building keyword list…" />
      ) : report.services.length === 0 || report.areas.length === 0 ? (
        <Card>
          <EmptyState
            icon="trending"
            title="Add services and service areas first"
            description="Keywords are built from the project’s services (or business type) and service areas (or location)."
            action={<ButtonLink to={`/service-area?project=${selected.id}`}>Set services and areas</ButtonLink>}
          />
        </Card>
      ) : (
        <div className="space-y-6">
          {!crawlReady ? (
            <Alert variant="info">
              The site has no completed crawl, so every keyword shows “Create a page”.{' '}
              <Link to={`/crawler?project=${selected.id}`} className="font-medium underline">
                Crawl the website
              </Link>{' '}
              to match keywords to existing pages.
            </Alert>
          ) : null}
          {!report.gscUsed ? (
            <Alert variant="info">
              Without Search Console, positions and impressions are not shown.{' '}
              <Link to={`/search-console?project=${selected.id}`} className="font-medium underline">
                Connect Search Console and choose this project’s property
              </Link>
              .
            </Alert>
          ) : gsc.value?.error ? (
            <Alert variant="warning" title="Search Console data could not be loaded">
              {gsc.value.error}
            </Alert>
          ) : null}

          <Card as="section" aria-labelledby="kw-summary">
            <CardHeader
              id="kw-summary"
              title={`${integer.format(report.rows.length)} keywords`}
              description={`${report.services.length} ${report.services.length === 1 ? 'service' : 'services'} × ${report.areas.length} ${report.areas.length === 1 ? 'area' : 'areas'}${report.gscUsed ? '; positions from the last 90 days of Search Console data' : ''}. Search volumes are not included: check them in a keyword tool before prioritising.`}
            />
            <dl className="grid grid-cols-2 gap-px bg-subtle sm:grid-cols-4">
              {(Object.keys(ACTION_LABELS) as KeywordAction[]).map((action) => (
                <div key={action} className="bg-surface px-5 py-4">
                  <dt className="text-xs font-medium text-ink-2">{ACTION_LABELS[action]}</dt>
                  <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{report.counts[action]}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card as="section" aria-labelledby="kw-table">
            <CardHeader
              id="kw-table"
              title="Keywords"
              description="Most urgent first: missing pages in the order of your service-area list, then pages to improve."
              action={
                <>
                  <label htmlFor="kw-filter" className="sr-only">
                    Filter by action
                  </label>
                  <select id="kw-filter" className={controlClasses(false)} value={filter} onChange={(event) => setFilter(event.target.value as ActionFilter)}>
                    <option value="all">All actions</option>
                    {(Object.keys(ACTION_LABELS) as KeywordAction[]).map((action) => (
                      <option key={action} value={action}>
                        {ACTION_LABELS[action]}
                      </option>
                    ))}
                  </select>
                </>
              }
            />
            {visible.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-2">No keywords match this filter.</p>
            ) : (
              <Table aria-label="Keyword opportunities">
                <thead>
                  <tr>
                    <Th>Keyword</Th>
                    <Th>Best page</Th>
                    <Th>Google</Th>
                    <Th className="text-right">Position</Th>
                    <Th className="text-right">Impressions</Th>
                    <Th className="text-right">Clicks</Th>
                    <Th>Next step</Th>
                  </tr>
                </thead>
                <tbody>
                  {visible.slice(0, limit).map((row) => {
                    const href = row.page ? getSafeHttpUrl(row.page.url) : null
                    return (
                      <tr key={row.keyword}>
                        <Td className="font-medium text-ink">
                          {row.keyword}
                          {row.gsc && row.gsc.topQuery !== row.keyword ? (
                            <p className="mt-0.5 text-xs font-normal text-ink-3">
                              Top search: “{row.gsc.topQuery}”{row.gsc.matchingQueries > 1 ? ` +${row.gsc.matchingQueries - 1} similar` : ''}
                            </p>
                          ) : null}
                        </Td>
                        <Td className="max-w-xs">
                          {row.page && href ? (
                            <>
                              <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent-ink hover:underline">
                                {formatUrlForDisplay(row.page.url, 45)}
                              </a>
                              {row.page.match === 'service_only' ? <p className="text-xs text-ink-3">Service page, not specific to {row.area}</p> : null}
                            </>
                          ) : (
                            <span className="text-ink-3">No page</span>
                          )}
                        </Td>
                        <Td>
                          <StatusBadge tone={STATUS_TONE[row.status]}>{STATUS_LABELS[row.status]}</StatusBadge>
                        </Td>
                        <Td className="text-right tabular-nums">{row.gsc && row.gsc.impressions > 0 ? row.gsc.position.toFixed(1) : '—'}</Td>
                        <Td className="text-right tabular-nums">{row.gsc ? integer.format(row.gsc.impressions) : '—'}</Td>
                        <Td className="text-right tabular-nums">{row.gsc ? integer.format(row.gsc.clicks) : '—'}</Td>
                        <Td>
                          <StatusBadge tone={ACTION_TONE[row.action]}>{ACTION_LABELS[row.action]}</StatusBadge>
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
            {visible.length > limit ? (
              <div className="border-t border-line-soft px-5 py-3">
                <Button variant="secondary" onClick={() => setLimit((value) => value + 100)}>
                  Show more ({integer.format(visible.length - limit)} left)
                </Button>
              </div>
            ) : null}
          </Card>

          {report.discovered.length > 0 ? (
            <Card as="section" aria-labelledby="kw-discovered">
              <CardHeader
                id="kw-discovered"
                title="Other local searches people already find you for"
                description="From Search Console: local searches with 10+ impressions that none of the keywords above covers. Consider adding the service or area they mention."
              />
              <Table aria-label="Discovered local searches">
                <thead>
                  <tr>
                    <Th>Search</Th>
                    <Th className="text-right">Position</Th>
                    <Th className="text-right">Impressions</Th>
                    <Th className="text-right">Clicks</Th>
                  </tr>
                </thead>
                <tbody>
                  {report.discovered.map((row) => (
                    <tr key={row.key}>
                      <Td>{row.key}</Td>
                      <Td className="text-right tabular-nums">{row.position.toFixed(1)}</Td>
                      <Td className="text-right tabular-nums">{integer.format(row.impressions)}</Td>
                      <Td className="text-right tabular-nums">{integer.format(row.clicks)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          ) : null}
        </div>
      )}
    </>
  )
}
