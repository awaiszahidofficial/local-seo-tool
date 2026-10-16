import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GSC_PERIODS, type GscPeriod } from '../../supabase/functions/_shared/gsc.ts'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { Table, Td, Th } from '../components/ui/Table'
import { controlClasses } from '../components/ui/fieldStyles'
import { useFlashNotice } from '../hooks/useFlashNotice'
import { useProjectList } from '../hooks/useProjectList'
import { formatDate } from '../lib/format'
import { TrendChart } from '../components/TrendChart'
import {
  compareTotals,
  dailySeries,
  isLocalQuery,
  localTerms,
  lowCtr,
  mergePeriods,
  sortByClicks,
  strikingDistance,
  suggestProperty,
  summarizeLocal,
  topMovers,
  type RowChange,
} from '../lib/gscAnalysis'
import { updateGscProperty } from '../lib/projects'
import {
  disconnectGsc,
  getGscPerformance,
  getGscStatus,
  listGscSites,
  startGscConnect,
  type GscPerformance,
  type GscResult,
  type GscSite,
  type GscStatus,
} from '../lib/searchConsole'
import { formatUrlForDisplay, getSafeHttpUrl } from '../lib/url'
import type { ProjectRow } from '../types/database'

// ---- Formatting -------------------------------------------------------------------------------

const integer = new Intl.NumberFormat('en-US')

function formatPct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}

function signed(value: number, digits = 0): string {
  const fixed = Math.abs(value).toFixed(digits)
  return value > 0 ? `+${fixed}` : value < 0 ? `−${fixed}` : fixed
}

function Change({ value, suffix = '', digits = 0, invert = false }: { value: number | null; suffix?: string; digits?: number; invert?: boolean }) {
  if (value === null) return <span className="text-ink-3">new</span>
  if (value === 0) return <span className="text-ink-3">no change</span>
  const good = invert ? value < 0 : value > 0
  return (
    <span className={good ? 'text-good' : 'text-bad'}>
      {signed(value, digits)}
      {suffix}
    </span>
  )
}

// ---- Data loading ---------------------------------------------------------------------------

type Loaded<T> = { key: string; result: GscResult<T> }

function useGscCall<T>(key: string | null, load: () => Promise<GscResult<T>>) {
  const [state, setState] = useState<Loaded<T> | null>(null)
  useEffect(() => {
    if (key === null) return
    let cancelled = false
    void load().then((result) => {
      if (!cancelled) setState({ key, result })
    })
    return () => {
      cancelled = true
    }
    // `load` is recreated each render; `key` captures everything it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const current = key !== null && state?.key === key ? state.result : null
  return { loading: key !== null && current === null, result: current }
}

// ---- Pieces -----------------------------------------------------------------------------------

function ConnectButton({ returnTo, label = 'Connect Google Search Console' }: { returnTo: string; label?: string }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function connect() {
    setBusy(true)
    setError(null)
    const result = await startGscConnect(returnTo)
    if (result.data) {
      window.location.assign(result.data.url)
      return
    }
    setBusy(false)
    setError(result.error)
  }
  return (
    <div className="space-y-3">
      <Button onClick={() => void connect()} loading={busy}>
        {label}
      </Button>
      {error ? (
        <Alert variant="error" title="Could not start the Google sign-in">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

function QueryTable({ rows, label, firstColumn, limit, showChange = true }: { rows: readonly RowChange[]; label: string; firstColumn: string; limit: number; showChange?: boolean }) {
  const [expanded, setExpanded] = useState(false)
  if (rows.length === 0) return <p className="px-5 py-6 text-center text-sm text-ink-2">No data for this period.</p>
  const visible = expanded ? rows : rows.slice(0, limit)
  const isPage = firstColumn === 'Page'
  return (
    <>
      <Table aria-label={label}>
        <thead>
          <tr>
            <Th>{firstColumn}</Th>
            <Th className="text-right">Clicks</Th>
            {showChange ? <Th className="text-right">Change</Th> : null}
            <Th className="text-right">Impressions</Th>
            <Th className="text-right">CTR</Th>
            <Th className="text-right">Position</Th>
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => {
            const href = isPage ? getSafeHttpUrl(row.key) : null
            return (
              <tr key={row.key}>
                <Td className="max-w-sm break-words">
                  {href ? (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent-ink hover:underline">
                      {formatUrlForDisplay(row.key, 60)}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  ) : (
                    row.key || <span className="text-ink-3">(not shown by Google)</span>
                  )}
                </Td>
                <Td className="text-right tabular-nums">{integer.format(row.clicks)}</Td>
                {showChange ? (
                  <Td className="text-right tabular-nums">
                    <Change value={row.prevClicks === 0 && row.clicks > 0 ? null : row.clickChange} />
                  </Td>
                ) : null}
                <Td className="text-right tabular-nums">{integer.format(row.impressions)}</Td>
                <Td className="text-right tabular-nums">{row.impressions > 0 ? formatPct(row.ctr) : '—'}</Td>
                <Td className="text-right tabular-nums">
                  {row.position === null ? '—' : row.position.toFixed(1)}
                  {row.positionChange !== null && row.positionChange !== 0 ? (
                    <span className="ml-1 text-xs">
                      (<Change value={row.positionChange} digits={1} />)
                    </span>
                  ) : null}
                </Td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      {rows.length > limit ? (
        <div className="border-t border-line-soft px-5 py-3">
          <Button variant="secondary" onClick={() => setExpanded((value) => !value)}>
            {expanded ? 'Show fewer' : `Show all ${integer.format(rows.length)}`}
          </Button>
        </div>
      ) : null}
    </>
  )
}

function PropertyPicker({ project, sites, onSaved }: { project: ProjectRow; sites: readonly GscSite[]; onSaved: (project: ProjectRow) => void }) {
  const suggested = suggestProperty(project.website_url, sites)
  const [value, setValue] = useState(project.gsc_property ?? suggested ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true)
    setError(null)
    const result = await updateGscProperty(project.id, value || null)
    setSaving(false)
    if (result.data === null) {
      setError(result.error)
      return
    }
    onSaved(result.data)
  }

  if (sites.length === 0) {
    return (
      <Alert variant="warning" title="No Search Console properties found">
        This Google account has no verified Search Console properties. Add and verify the site at search.google.com/search-console, or
        connect a different Google account.
      </Alert>
    )
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1">
          <label htmlFor="gsc-property" className="mb-1 block text-sm font-medium text-ink">
            Search Console property for {project.name}
          </label>
          <select id="gsc-property" className={controlClasses(false)} value={value} onChange={(event) => setValue(event.target.value)}>
            <option value="">Choose a property…</option>
            {sites.map((site) => (
              <option key={site.siteUrl} value={site.siteUrl}>
                {site.siteUrl}
                {site.siteUrl === suggested ? ' (matches the project website)' : ''}
              </option>
            ))}
          </select>
        </div>
        <Button onClick={() => void save()} loading={saving} disabled={!value || value === project.gsc_property}>
          Use this property
        </Button>
      </div>
      {error ? (
        <Alert variant="error" title="Could not save the property">
          {error}
        </Alert>
      ) : null}
    </div>
  )
}

function PerformanceReport({ project, data }: { project: ProjectRow; data: GscPerformance }) {
  const totals = compareTotals(data.totals.current, data.totals.previous)
  const { current: queriesNow, previous: queriesBefore } = data.queries
  const { current: pagesNow, previous: pagesBefore } = data.pages
  const queries = useMemo(() => sortByClicks(mergePeriods(queriesNow, queriesBefore)), [queriesNow, queriesBefore])
  const pages = useMemo(() => sortByClicks(mergePeriods(pagesNow, pagesBefore)), [pagesNow, pagesBefore])
  const terms = useMemo(() => localTerms(project), [project])
  const local = useMemo(() => queries.filter((row) => isLocalQuery(row.key, terms)), [queries, terms])
  const localSummary = summarizeLocal(local, totals.current.clicks)
  const striking = useMemo(() => strikingDistance(queries), [queries])
  const weakCtr = useMemo(() => lowCtr(queries), [queries])
  const movers = useMemo(() => topMovers(queries), [queries])
  const [metric, setMetric] = useState<'clicks' | 'impressions'>('clicks')
  const { current: rangeNow, previous: rangeBefore } = data.ranges
  const daily = data.daily
  const dailyNow = useMemo(() => (daily ? dailySeries(rangeNow, daily.current) : null), [daily, rangeNow])
  const dailyBefore = useMemo(() => (daily ? dailySeries(rangeBefore, daily.previous) : []), [daily, rangeBefore])

  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="gsc-totals">
        <CardHeader
          id="gsc-totals"
          title="Search performance"
          description={`${formatDate(data.ranges.current.startDate, { timeZone: 'UTC' })} – ${formatDate(data.ranges.current.endDate, { timeZone: 'UTC' })}, compared with the ${formatDate(data.ranges.previous.startDate, { timeZone: 'UTC' })} – ${formatDate(data.ranges.previous.endDate, { timeZone: 'UTC' })} period before it. Property: ${data.property}`}
        />
        <dl className="grid grid-cols-2 gap-px bg-subtle sm:grid-cols-4">
          <div className="bg-surface px-5 py-4">
            <dt className="text-xs font-medium text-ink-2">Clicks</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{integer.format(totals.current.clicks)}</dd>
            <dd className="text-xs tabular-nums">
              <Change value={totals.clicksPct} suffix="%" digits={1} />
            </dd>
          </div>
          <div className="bg-surface px-5 py-4">
            <dt className="text-xs font-medium text-ink-2">Impressions</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{integer.format(totals.current.impressions)}</dd>
            <dd className="text-xs tabular-nums">
              <Change value={totals.impressionsPct} suffix="%" digits={1} />
            </dd>
          </div>
          <div className="bg-surface px-5 py-4">
            <dt className="text-xs font-medium text-ink-2">Average CTR</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{formatPct(totals.current.ctr)}</dd>
            <dd className="text-xs tabular-nums">
              <Change value={totals.ctrPoints} suffix=" pts" digits={1} />
            </dd>
          </div>
          <div className="bg-surface px-5 py-4">
            <dt className="text-xs font-medium text-ink-2">Average position</dt>
            <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{totals.current.position ? totals.current.position.toFixed(1) : '—'}</dd>
            <dd className="text-xs tabular-nums">
              <Change value={totals.positionChange} digits={1} />
            </dd>
          </div>
        </dl>
      </Card>

      <Card as="section" aria-labelledby="gsc-trend">
        <CardHeader
          id="gsc-trend"
          title="Daily trend"
          action={
            <div role="group" aria-label="Metric" className="flex rounded-lg border border-line p-0.5 text-xs">
              {(['clicks', 'impressions'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={metric === value}
                  onClick={() => setMetric(value)}
                  className={`rounded-md px-2.5 py-1 font-medium capitalize ${metric === value ? 'bg-accent-soft text-ink' : 'text-ink-3 hover:text-ink-2'}`}
                >
                  {value}
                </button>
              ))}
            </div>
          }
        />
        <div className="p-5">
          {dailyNow ? (
            <TrendChart current={dailyNow} previous={dailyBefore} metric={metric} label="Search performance" />
          ) : (
            <p className="text-sm text-ink-3">
              Redeploy the Search Console function (npx supabase functions deploy gsc) to see the daily trend.
            </p>
          )}
        </div>
      </Card>

      <Card as="section" aria-labelledby="gsc-local">
        <CardHeader
          id="gsc-local"
          title="Local searches"
          description={
            terms.length > 0
              ? `Queries naming one of the project’s service areas, or “near me”. ${integer.format(localSummary.queries)} queries, ${integer.format(localSummary.clicks)} clicks${localSummary.shareOfClicks !== null ? ` (${localSummary.shareOfClicks}% of all clicks)` : ''}.`
              : 'Queries containing “near me”. Add service areas (Service-Area Coverage) or a location to the project to include city searches.'
          }
        />
        <QueryTable rows={local} label="Local queries" firstColumn="Query" limit={15} />
      </Card>

      <Card as="section" aria-labelledby="gsc-striking">
        <CardHeader
          id="gsc-striking"
          title="Almost on top: positions 4 to 20"
          description="Searches with real demand where the site sits just below the top results. Improving the matching page (title, content, internal links) is often the fastest win."
        />
        <QueryTable rows={striking} label="Striking-distance queries" firstColumn="Query" limit={15} />
      </Card>

      {weakCtr.length > 0 ? (
        <Card as="section" aria-labelledby="gsc-ctr">
          <CardHeader
            id="gsc-ctr"
            title="Ranking well, but few clicks"
            description="Top-5 positions with a click-through rate under half of what that position usually gets. Rewrite the page title and meta description to match what searchers want."
          />
          <QueryTable rows={weakCtr} label="Low click-through queries" firstColumn="Query" limit={10} />
        </Card>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card as="section" aria-labelledby="gsc-gainers">
          <CardHeader id="gsc-gainers" title="Biggest gains" description="Queries with the most extra clicks." />
          <QueryTable rows={movers.gainers} label="Gaining queries" firstColumn="Query" limit={10} />
        </Card>
        <Card as="section" aria-labelledby="gsc-losers">
          <CardHeader id="gsc-losers" title="Biggest losses" description="Queries that lost the most clicks." />
          <QueryTable rows={movers.losers} label="Losing queries" firstColumn="Query" limit={10} />
        </Card>
      </div>

      <Card as="section" aria-labelledby="gsc-queries">
        <CardHeader id="gsc-queries" title="Top queries" description="Up to 1,000 queries, by clicks. Google hides very rare searches for privacy." />
        <QueryTable rows={queries} label="Top queries" firstColumn="Query" limit={25} />
      </Card>

      <Card as="section" aria-labelledby="gsc-pages">
        <CardHeader id="gsc-pages" title="Top pages" description="Pages that received clicks or impressions, by clicks." />
        <QueryTable rows={pages} label="Top pages" firstColumn="Page" limit={25} />
      </Card>
    </div>
  )
}

// ---- Page -----------------------------------------------------------------------------------

export function SearchConsolePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [notice] = useFlashNotice()
  const projectsState = useProjectList()
  const requestedId = searchParams.get('project')
  const [savedProject, setSavedProject] = useState<ProjectRow | null>(null)
  const listed = projectsState.projects?.find((project) => project.id === requestedId) ?? null
  const selected = listed && savedProject?.id === listed.id ? savedProject : listed
  const daysParam = Number(searchParams.get('days'))
  const days: GscPeriod = (GSC_PERIODS as readonly number[]).includes(daysParam) ? (daysParam as GscPeriod) : 28

  const [statusVersion, setStatusVersion] = useState(0)
  const status = useGscCall<GscStatus>(`status:${statusVersion}`, getGscStatus)
  const connected = status.result?.data?.connected === true
  const sites = useGscCall(connected ? `sites:${statusVersion}` : null, listGscSites)
  const property = selected?.gsc_property ?? null
  const performance = useGscCall(
    connected && selected && property ? `perf:${selected.id}:${property}:${days}:${statusVersion}` : null,
    () => getGscPerformance(selected?.id ?? '', days),
  )
  const [changingProperty, setChangingProperty] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)

  const returnTo = `/search-console${selected ? `?project=${selected.id}` : ''}`

  function setParam(name: string, value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(name, value)
    else next.delete(name)
    setSearchParams(next, { replace: true })
  }

  async function disconnect() {
    setDisconnecting(true)
    await disconnectGsc()
    setDisconnecting(false)
    setStatusVersion((value) => value + 1)
  }

  const header = (
    <PageHeader
      title="Google Search Console"
      description="See how each client’s site performs in Google Search: clicks, impressions and positions, local searches, queries close to the top, and what is gaining or losing."
    />
  )

  if (projectsState.loading || status.loading) {
    return (
      <>
        {header}
        <LoadingState label="Loading…" />
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

  const statusError = status.result?.error ?? null
  const statusCode = status.result?.code ?? null
  const reconnectNeeded = [sites.result?.code, performance.result?.code].includes('reconnect')

  return (
    <>
      {header}
      {notice ? (
        <Alert variant="success" className="mb-6">
          {notice}
        </Alert>
      ) : null}

      <Card as="section" aria-labelledby="gsc-connection" className="mb-6">
        <CardHeader id="gsc-connection" title="Google connection" />
        <div className="p-5">
          {statusError ? (
            <Alert variant={statusCode === 'not_configured' ? 'warning' : 'error'} title={statusCode === 'not_configured' ? 'Google is not set up yet' : 'Could not check the Google connection'}>
              {statusError}
            </Alert>
          ) : connected && !reconnectNeeded ? (
            <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
              <p className="text-ink">
                Connected{status.result?.data?.email ? ` as ${status.result.data.email}` : ''}. Read-only access to Search Console.
              </p>
              <Button variant="secondary" onClick={() => void disconnect()} loading={disconnecting}>
                Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3 text-sm text-ink-2">
              <p>
                {reconnectNeeded
                  ? 'The Google connection has expired. Connect again to keep loading data.'
                  : 'Sign in with the Google account that has access to your clients’ Search Console properties. The app only asks for read-only access.'}
              </p>
              <ConnectButton returnTo={returnTo} label={reconnectNeeded ? 'Connect Google again' : undefined} />
            </div>
          )}
        </div>
      </Card>

      {!connected || statusError ? null : !projectsState.projects || projectsState.projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="search"
            title="Create a project first"
            description="Each project is linked to one Search Console property."
            action={<ButtonLink to="/projects/new">New project</ButtonLink>}
          />
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex flex-wrap items-end gap-4 p-5">
              <ProjectSelect
                id="gsc-project"
                projects={projectsState.projects}
                value={selected?.id ?? ''}
                onChange={(projectId) => {
                  setChangingProperty(false)
                  setParam('project', projectId || null)
                }}
              />
              <div className="min-w-[10rem]">
                <label htmlFor="gsc-days" className="mb-1 block text-sm font-medium text-ink">
                  Period
                </label>
                <select id="gsc-days" className={controlClasses(false)} value={days} onChange={(event) => setParam('days', event.target.value)}>
                  {GSC_PERIODS.map((value) => (
                    <option key={value} value={value}>
                      Last {value} days
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="border-t border-line-soft px-5 py-3 text-xs text-ink-2">
              Search Console data arrives about 3 days late, so periods end 3 days ago. Each period is compared with the one just before it.
            </p>
          </Card>

          {!selected ? (
            <Card>
              <EmptyState icon="search" title="Choose a project" description="Pick a project above to see its search performance." />
            </Card>
          ) : !property || changingProperty ? (
            <Card as="section" aria-labelledby="gsc-property-heading" className="mb-6">
              <CardHeader id="gsc-property-heading" title="Link a Search Console property" />
              <div className="p-5">
                {sites.loading ? (
                  <LoadingState label="Loading your Search Console properties…" />
                ) : sites.result?.error ? (
                  <Alert variant="error" title="Could not load properties">
                    {sites.result.error}
                  </Alert>
                ) : (
                  <PropertyPicker
                    key={selected.id}
                    project={selected}
                    sites={sites.result?.data?.sites ?? []}
                    onSaved={(project) => {
                      setSavedProject(project)
                      setChangingProperty(false)
                    }}
                  />
                )}
              </div>
            </Card>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-2">
                Property: <span className="font-medium">{property}</span>{' '}
                <button type="button" className="font-medium text-accent-ink hover:underline" onClick={() => setChangingProperty(true)}>
                  Change
                </button>
              </p>
              {performance.loading ? (
                <LoadingState label="Loading data from Search Console…" />
              ) : performance.result?.error ? (
                <Alert variant="error" title="Could not load Search Console data">
                  {performance.result.error}
                </Alert>
              ) : performance.result?.data ? (
                <PerformanceReport project={selected} data={performance.result.data} />
              ) : null}
            </>
          )}

          {selected && !selected.location && (selected.service_areas ?? []).length === 0 ? (
            <p className="mt-6 text-xs text-ink-2">
              Tip: add a location or{' '}
              <Link to={`/service-area?project=${selected.id}`} className="font-medium text-accent-ink hover:underline">
                service areas
              </Link>{' '}
              to this project to spot local searches.
            </p>
          ) : null}
        </>
      )}
    </>
  )
}
