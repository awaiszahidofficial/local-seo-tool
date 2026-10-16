import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
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
import { TextAreaField } from '../components/ui/TextAreaField'
import { useLatestCrawl } from '../hooks/useLatestCrawl'
import { useProjectList } from '../hooks/useProjectList'
import { formatDateTime } from '../lib/format'
import { needsRecrawl } from '../lib/localAudit'
import { updateCoverageLists } from '../lib/projects'
import {
  AREA_STATUS_LABELS,
  MAX_LIST_ITEMS,
  analyzeCoverage,
  effectiveAreas,
  effectiveServices,
  parseList,
  suggestAreasFromSite,
  type AreaResult,
  type AreaStatus,
  type CoverageReport,
} from '../lib/serviceArea'
import { formatUrlForDisplay, getSafeHttpUrl } from '../lib/url'
import type { CrawlPageRow, ProjectRow } from '../types/database'

const STATUS_TONE: Record<AreaStatus, BadgeTone> = {
  covered: 'success',
  needs_work: 'warning',
  mentioned: 'danger',
  missing: 'danger',
}

function PageLink({ url, max = 50 }: { url: string; max?: number }) {
  const href = getSafeHttpUrl(url)
  if (!href) return <span className="break-all">{url}</span>
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="break-all text-accent-ink hover:underline">
      {formatUrlForDisplay(url, max)}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

// ---- Lists editor ---------------------------------------------------------------------------

type ListsEditorProps = {
  project: ProjectRow
  pages: readonly CrawlPageRow[]
  onSaved: (project: ProjectRow) => void
}

function ListsEditor({ project, pages, onSaved }: ListsEditorProps) {
  const [areasText, setAreasText] = useState((project.service_areas ?? []).join('\n'))
  const [servicesText, setServicesText] = useState((project.services ?? []).join('\n'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const areas = useMemo(() => parseList(areasText), [areasText])
  const services = useMemo(() => parseList(servicesText), [servicesText])
  const siteSuggestions = useMemo(() => suggestAreasFromSite(pages, areas), [pages, areas])
  const unchanged =
    areas.join('\n') === (project.service_areas ?? []).join('\n') && services.join('\n') === (project.services ?? []).join('\n')

  function addArea(name: string) {
    setSaved(false)
    setAreasText((text) => (text.trim() ? `${text.replace(/\s+$/, '')}\n${name}` : name))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaving(true)
    setError(null)
    setSaved(false)
    const result = await updateCoverageLists(project.id, { service_areas: areas, services })
    setSaving(false)
    if (result.data === null) {
      setError(result.error)
      return
    }
    setAreasText(areas.join('\n'))
    setServicesText(services.join('\n'))
    setSaved(true)
    onSaved(result.data)
  }

  return (
    <Card as="section" aria-labelledby="coverage-lists" className="mb-6">
      <CardHeader
        id="coverage-lists"
        title="Service areas and services"
        description="One per line. Put the most important areas first: suggestions follow this order."
      />
      <form onSubmit={(event) => void handleSubmit(event)} className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextAreaField
            id="service-areas"
            label="Service areas"
            rows={7}
            value={areasText}
            onChange={(event) => {
              setSaved(false)
              setAreasText(event.target.value)
            }}
            placeholder={'Austin, TX\nRound Rock, TX\nCedar Park, TX'}
            hint={`Cities, suburbs or neighbourhoods, up to ${MAX_LIST_ITEMS}. Add the state after a comma if you like.`}
          />
          <TextAreaField
            id="services"
            label="Services"
            rows={7}
            value={servicesText}
            onChange={(event) => {
              setSaved(false)
              setServicesText(event.target.value)
            }}
            placeholder={'Drain cleaning\nWater heater repair\nLeak detection'}
            hint={
              project.business_type
                ? `Leave empty to use the business type “${project.business_type}”.`
                : 'The main services you want to rank for in each area.'
            }
          />
        </div>

        {siteSuggestions.length > 0 ? (
          <div>
            <p className="text-sm font-medium text-ink">Areas your site already has pages for</p>
            <ul className="mt-2 flex flex-wrap gap-2" aria-label="Suggested service areas">
              {siteSuggestions.map((name) => (
                <li key={name}>
                  <button
                    type="button"
                    onClick={() => addArea(name)}
                    className="rounded-full border border-line-strong bg-surface px-3 py-1 text-xs font-medium text-ink-2 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    + {name}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {error ? (
          <Alert variant="error" title="Could not save">
            {error}
          </Alert>
        ) : null}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" loading={saving} disabled={unchanged && !saving}>
            Save lists
          </Button>
          {saved ? <span className="text-sm text-good">Saved. The results below are updated.</span> : null}
          {!unchanged && !saving ? <span className="text-sm text-ink-2">Unsaved changes</span> : null}
        </div>
      </form>
    </Card>
  )
}

// ---- Results --------------------------------------------------------------------------------

function AreaRow({ result }: { result: AreaResult }) {
  return (
    <tr>
      <Td className="font-medium text-ink">
        <span className="mr-2 text-xs text-ink-3 tabular-nums">{result.priority + 1}.</span>
        {result.area.label}
      </Td>
      <Td>
        <StatusBadge tone={STATUS_TONE[result.status]}>{AREA_STATUS_LABELS[result.status]}</StatusBadge>
      </Td>
      <Td className="max-w-xs">
        {result.bestPage ? (
          <>
            <PageLink url={result.bestPage.url} />
            <p className="mt-0.5 text-xs text-ink-3">{result.bestPage.wordCount} words</p>
          </>
        ) : (
          <span className="text-ink-3">
            {result.mentionPages > 0
              ? `Mentioned on ${result.mentionPages} ${result.mentionPages === 1 ? 'page' : 'pages'}, no dedicated page`
              : 'Not mentioned anywhere'}
          </span>
        )}
      </Td>
      <Td className="max-w-md">
        {result.issues.length === 0 ? (
          result.bestPage ? (
            <span className="text-good">Looks good</span>
          ) : (
            <span className="text-ink-3">Create a page (see suggestions)</span>
          )
        ) : (
          <ul className="list-disc space-y-1 pl-4 text-ink-2">
            {result.issues.map((issue) => (
              <li key={issue.id} className={issue.severity === 'fail' ? 'text-bad' : undefined}>
                {issue.text}
              </li>
            ))}
          </ul>
        )}
      </Td>
    </tr>
  )
}

function CoverageResults({ report }: { report: CoverageReport }) {
  const [showAllSuggestions, setShowAllSuggestions] = useState(false)
  const suggestions = showAllSuggestions ? report.suggestions : report.suggestions.slice(0, 10)

  return (
    <div className="space-y-6">
      <Card as="section" aria-labelledby="coverage-summary">
        <CardHeader
          id="coverage-summary"
          title="Coverage summary"
          description={`${report.coveragePercent}% of your service areas have a dedicated page.`}
        />
        <dl className="grid grid-cols-2 gap-px bg-subtle sm:grid-cols-4">
          {(
            [
              ['Covered', report.totals.covered],
              ['Page needs work', report.totals.needs_work],
              ['Mentioned only', report.totals.mentioned],
              ['No content', report.totals.missing],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-surface px-5 py-4">
              <dt className="text-xs font-medium text-ink-2">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </Card>

      {report.suggestions.length > 0 ? (
        <Card as="section" aria-labelledby="next-pages">
          <CardHeader
            id="next-pages"
            title="Pages to create next"
            description="In the order of your service-area list. Suggested addresses follow the folder your existing area pages use."
          />
          <ol className="divide-y divide-line-soft">
            {suggestions.map((suggestion) => (
              <li key={`${suggestion.area}|${suggestion.service ?? ''}|${suggestion.reason}`} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">{suggestion.h1}</span>
                  <StatusBadge tone={suggestion.reason === 'service_gap' ? 'neutral' : 'danger'}>
                    {suggestion.reason === 'missing'
                      ? 'No content yet'
                      : suggestion.reason === 'mentioned'
                        ? 'Only mentioned'
                        : 'Service not covered here'}
                  </StatusBadge>
                </div>
                <dl className="mt-1 grid gap-x-4 gap-y-0.5 text-ink-2 sm:grid-cols-[auto_1fr]">
                  <dt className="text-xs font-medium">URL</dt>
                  <dd className="break-all font-mono text-xs">{suggestion.url}</dd>
                  <dt className="text-xs font-medium">Title</dt>
                  <dd className="text-xs">{suggestion.title}</dd>
                </dl>
              </li>
            ))}
          </ol>
          {report.suggestions.length > 10 ? (
            <div className="border-t border-line-soft px-5 py-3">
              <Button variant="secondary" onClick={() => setShowAllSuggestions((value) => !value)}>
                {showAllSuggestions ? 'Show fewer' : `Show all ${report.suggestions.length}`}
              </Button>
            </div>
          ) : null}
        </Card>
      ) : (
        <Alert variant="success">Every service area has a dedicated page.</Alert>
      )}

      <Card as="section" aria-labelledby="area-results">
        <CardHeader id="area-results" title="Area by area" description="The strongest page found for each area, and what to improve on it." />
        <Table aria-label="Service area coverage">
          <thead>
            <tr>
              <Th>Area</Th>
              <Th>Status</Th>
              <Th>Best page</Th>
              <Th>What to do</Th>
            </tr>
          </thead>
          <tbody>
            {report.areas.map((result) => (
              <AreaRow key={result.area.label} result={result} />
            ))}
          </tbody>
        </Table>
      </Card>

      {report.duplicates.length > 0 ? (
        <Card as="section" aria-labelledby="duplicates">
          <CardHeader
            id="duplicates"
            title="Near-duplicate area pages"
            description="These pages read almost the same once the city names are ignored. Rewrite them with content specific to each area."
          />
          <ul className="divide-y divide-line-soft">
            {report.duplicates.slice(0, 20).map((pair) => (
              <li key={`${pair.a.pageId}|${pair.b.pageId}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 text-sm">
                <span className="font-medium text-ink">
                  {pair.areaA} and {pair.areaB}
                </span>
                <StatusBadge tone="warning">{`${Math.round(pair.similarity * 100)}% the same`}</StatusBadge>
                <span className="w-full text-xs text-ink-2">
                  <PageLink url={pair.a.url} max={40} /> · <PageLink url={pair.b.url} max={40} />
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {report.matrix ? (
        <Card as="section" aria-labelledby="service-matrix">
          <CardHeader
            id="service-matrix"
            title="Services by area"
            description={`${report.matrix.covered} of ${report.matrix.total} service and area combinations have a page naming both (in its address, title or main heading).`}
          />
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm" aria-label="Services by area">
              <thead>
                <tr className="bg-surface-2">
                  <th scope="col" className="sticky left-0 bg-surface-2 px-4 py-2 text-left text-xs font-semibold text-ink-2">
                    Service
                  </th>
                  {report.matrix.areas.map((area) => (
                    <th key={area} scope="col" className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap text-ink-2">
                      {area}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line-soft">
                {report.matrix.services.map((service, serviceIndex) => (
                  <tr key={service}>
                    <th scope="row" className="sticky left-0 bg-surface px-4 py-2 text-left font-medium text-ink">
                      {service}
                    </th>
                    {report.matrix?.cells[serviceIndex]?.map((cell, areaIndex) => (
                      <td key={report.matrix?.areas[areaIndex] ?? areaIndex} className="px-3 py-2">
                        {cell.pageUrl ? (
                          <span className="text-good" title={cell.pageUrl}>
                            <span aria-hidden="true">✓</span>
                            <span className="sr-only">Has a page: {cell.pageUrl}</span>
                          </span>
                        ) : (
                          <span className="text-ink-3">
                            <span aria-hidden="true">—</span>
                            <span className="sr-only">No page</span>
                          </span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <p className="text-xs text-ink-3">
        A page counts as dedicated to an area when the area is in its address, or in both its title and main heading.
        Results use the latest crawl as served, without JavaScript. Internal links are counted from the first 40 links
        stored per page, so a page reported as unlinked may still be linked from somewhere the crawl did not record.
      </p>
    </div>
  )
}

// ---- Page -----------------------------------------------------------------------------------

export function ServiceAreaPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const requestedId = searchParams.get('project')
  const projects = projectsState.projects
  const listed = projects?.find((project) => project.id === requestedId) ?? null
  const [savedProject, setSavedProject] = useState<ProjectRow | null>(null)
  const selected = listed && savedProject?.id === listed.id ? savedProject : listed
  const crawlState = useLatestCrawl(selected?.id ?? null)

  const crawl = crawlState.crawl
  const stale = needsRecrawl(crawlState.pages)
  const report = useMemo(
    () =>
      selected && crawl?.status === 'completed' && !stale && effectiveAreas(selected).length > 0
        ? analyzeCoverage(selected, crawlState.pages)
        : null,
    [selected, crawl, stale, crawlState.pages],
  )

  const header = (
    <PageHeader
      title="Service-Area Coverage"
      description="Compare the areas a business serves with the pages its website actually has, find gaps and weak or duplicate area pages, and see which pages to create next."
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
            icon="map"
            title="Create a project to check its service areas"
            description="Coverage is checked against the website saved in a project."
            action={<ButtonLink to="/projects/new">New project</ButtonLink>}
          />
        </Card>
      </>
    )
  }

  const crawlLink = selected ? `/crawler?project=${selected.id}` : '/crawler'
  const usingFallbackAreas = selected ? (selected.service_areas ?? []).length === 0 && effectiveAreas(selected).length > 0 : false
  const services = selected ? effectiveServices(selected) : []

  return (
    <>
      {header}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="coverage-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(projectId) => {
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
        <p className="border-t border-line-soft px-5 py-3 text-xs text-ink-2">
          Coverage is checked against the most recent crawl, so crawl the site again after adding pages.
        </p>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="map" title="Choose a project" description="Pick a project above to check its service-area coverage." />
        </Card>
      ) : crawlState.loading ? (
        <LoadingState label="Loading the latest crawl…" />
      ) : (
        <>
          <ListsEditor
            key={selected.id}
            project={selected}
            pages={crawlState.pages}
            onSaved={setSavedProject}
          />

          {crawlState.error ? (
            <Alert variant="error" title="Could not load crawl data">
              {crawlState.error}
            </Alert>
          ) : !crawl ? (
            <Card>
              <EmptyState
                icon="globe"
                title="Crawl this website first"
                description="Coverage is worked out from pages collected by the Website Crawler. Run a crawl for this project, then come back."
                action={<ButtonLink to={crawlLink}>Go to Website Crawler</ButtonLink>}
              />
            </Card>
          ) : crawl.status !== 'completed' ? (
            <Alert
              variant={crawl.status === 'failed' ? 'error' : 'info'}
              title={crawl.status === 'failed' ? 'The last crawl failed' : 'A crawl is still running'}
            >
              {crawl.status === 'failed'
                ? (crawl.error_message ?? 'Run the crawl again to check coverage.')
                : 'Wait for it to finish (or resume it), then reload this page.'}{' '}
              <Link to={crawlLink} className="font-medium underline">
                Open the Website Crawler
              </Link>
            </Alert>
          ) : stale ? (
            <Alert variant="warning" title="Crawl again to check coverage">
              This crawl was made before page text was stored.{' '}
              <Link to={crawlLink} className="font-medium underline">
                Crawl {selected.name} again
              </Link>
              .
            </Alert>
          ) : !report ? (
            <Card>
              <EmptyState
                icon="map"
                title="Add the areas this business serves"
                description="List the cities or neighbourhoods above and save. The project has no primary location to start from."
              />
            </Card>
          ) : (
            <>
              {usingFallbackAreas ? (
                <Alert variant="info" className="mb-6">
                  No service areas are saved yet, so only the project’s primary location “{selected.location}” is checked. Add
                  the other areas this business serves above.
                </Alert>
              ) : null}
              {services.length === 0 ? (
                <Alert variant="info" className="mb-6">
                  No services or business type are set, so the services-by-area grid and service checks are skipped.
                </Alert>
              ) : null}
              <p className="mb-4 text-xs text-ink-2">
                Based on the crawl from {formatDateTime(crawl.started_at)}: {report.usablePages}{' '}
                {report.usablePages === 1 ? 'page' : 'pages'} loaded successfully.
              </p>
              <CoverageResults report={report} />
            </>
          )}
        </>
      )}
    </>
  )
}
