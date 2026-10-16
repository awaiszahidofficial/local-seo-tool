import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ScoreRing } from '../components/ScoreRing'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/Spinner'
import { PageHeader } from '../components/ui/PageHeader'
import { useLoad } from '../hooks/useLoad'
import { useProjectList } from '../hooks/useProjectList'
import { formatDate } from '../lib/format'
import { formatUrlForDisplay } from '../lib/url'
import {
  BAND_LABELS,
  SCORE_PARTS,
  bandFor,
  loadClientInputs,
  mapWithLimit,
  scoreClient,
  type ClientScore,
} from '../lib/visibilityScore'
import type { ProjectRow } from '../types/database'

const integer = new Intl.NumberFormat('en-US')

const BAND_TEXT = { strong: 'text-good', fair: 'text-warn', weak: 'text-bad' } as const

function PartBar({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
      <span className="text-xs text-ink-2">{label}</span>
      <span className="text-xs font-medium text-ink tabular-nums">{value === null ? <span className="font-normal text-ink-3">Not set up</span> : value}</span>
      <span className="col-span-2 h-1 overflow-hidden rounded-full bg-subtle" aria-hidden="true">
        {value !== null ? <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(value, 2)}%` }} /> : null}
      </span>
    </div>
  )
}

function ClientCard({ project, score }: { project: ProjectRow; score: ClientScore }) {
  const band = score.overall === null ? null : bandFor(score.overall)
  const focus = SCORE_PARTS.find((part) => part.id === score.focus) ?? null
  return (
    <li className="flex flex-col rounded-xl border border-line bg-surface p-5 transition-colors hover:border-line-strong">
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <Link to={`/projects/${project.id}`} className="block truncate text-base font-semibold text-ink hover:text-accent-ink">
            {project.name}
          </Link>
          <p className="truncate text-sm text-ink-3">{formatUrlForDisplay(project.website_url, 40)}</p>
          {band ? <p className={`mt-3 text-sm font-medium ${BAND_TEXT[band]}`}>{BAND_LABELS[band]} local visibility</p> : <p className="mt-3 text-sm text-ink-3">Not enough data yet</p>}
        </div>
        <ScoreRing value={score.overall} label={`${project.name} local visibility`} />
      </div>

      <div className="mt-5 space-y-3">
        {SCORE_PARTS.map((part) => (
          <PartBar key={part.id} label={part.label} value={score.parts[part.id]} />
        ))}
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-line-soft pt-4 text-xs text-ink-3">
        <span>{score.lastCrawl ? `Crawled ${formatDate(score.lastCrawl)}, ${integer.format(score.pagesCrawled)} pages` : 'Not crawled yet'}</span>
        {focus ? (
          <Link to={`${focus.link}?project=${project.id}`} className="font-medium text-accent-ink hover:underline">
            {score.parts[focus.id] === null ? `Set up ${focus.label.toLowerCase()}` : `Improve ${focus.label.toLowerCase()}`}
          </Link>
        ) : null}
      </div>
    </li>
  )
}

export function OverviewPage() {
  const { projects, loading, error, reload } = useProjectList()
  const key = projects ? projects.map((project) => `${project.id}:${project.updated_at}`).join('|') : null
  const scores = useLoad(key, async () => {
    const list = projects ?? []
    const inputs = await mapWithLimit(list, 3, (project) => loadClientInputs(project))
    return list.map((project, index) => ({ project, score: scoreClient(project, inputs[index] ?? { crawl: null, pages: [], gbp: null, listings: null }) }))
  })

  const sorted = useMemo(
    () => [...(scores.value ?? [])].sort((a, b) => (a.score.overall ?? -1) - (b.score.overall ?? -1)),
    [scores.value],
  )
  const scored = sorted.filter((entry) => entry.score.overall !== null)
  const average = scored.length > 0 ? Math.round(scored.reduce((sum, entry) => sum + (entry.score.overall ?? 0), 0) / scored.length) : null
  const attention = scored.filter((entry) => (entry.score.overall ?? 100) < 50).length
  const pages = sorted.reduce((sum, entry) => sum + entry.score.pagesCrawled, 0)

  return (
    <>
      <PageHeader
        title="Overview"
        description="Local visibility for every client, weakest first. Each score combines website health, service-area pages, the Business Profile and listings."
        actions={projects && projects.length > 0 ? <ButtonLink to="/projects/new">New client</ButtonLink> : undefined}
      />

      {loading ? <LoadingState label="Loading your clients…" /> : null}

      {error ? (
        <Alert variant="error" title="Could not load your clients">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {projects && projects.length === 0 ? (
        <Card>
          <EmptyState
            icon="pin"
            title="Add your first client"
            description="A client is one business website. Add it, crawl it, and every module starts working on it."
            action={<ButtonLink to="/projects/new">Add a client</ButtonLink>}
          />
        </Card>
      ) : null}

      {projects && projects.length > 0 ? (
        <>
          <dl className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
            {(
              [
                ['Clients', integer.format(projects.length)],
                ['Average visibility', average === null ? '—' : `${average}`],
                ['Weak, need attention', scores.value ? integer.format(attention) : '—'],
                ['Pages monitored', scores.value ? integer.format(pages) : '—'],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="bg-surface px-5 py-4">
                <dt className="text-xs text-ink-3">{label}</dt>
                <dd className="mt-1.5 text-[1.65rem] leading-none font-semibold text-ink tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>

          {scores.loading && !scores.value ? (
            <LoadingState label="Scoring your clients…" />
          ) : (
            <ul aria-label="Clients" className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
              {sorted.map(({ project, score }) => (
                <ClientCard key={project.id} project={project} score={score} />
              ))}
            </ul>
          )}
        </>
      ) : null}
    </>
  )
}
