import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { StatusBadge, type BadgeTone } from '../components/ui/StatusBadge'
import { controlClasses } from '../components/ui/fieldStyles'
import { useLoad } from '../hooks/useLoad'
import { useProjectList } from '../hooks/useProjectList'
import { loadProjectBundle } from '../lib/projectBundle'
import { listRecommendationStates, setRecommendationState } from '../lib/recommendationStates'
import {
  EFFORT_LABELS,
  IMPACT_LABELS,
  MODULE_LABELS,
  buildRecommendations,
  splitByState,
  type Impact,
  type RecModule,
  type RecView,
  type Recommendation,
} from '../lib/recommendations'
import type { RecommendationStateRow } from '../types/database'

const IMPACT_TONE: Record<Impact, BadgeTone> = { high: 'danger', medium: 'warning', low: 'neutral' }

const VIEW_LABELS: Record<RecView, string> = { open: 'To do', done: 'Done', dismissed: 'Dismissed' }

function RecItem({
  rec,
  view,
  busy,
  onChange,
}: {
  rec: Recommendation
  view: RecView
  busy: boolean
  onChange: (status: 'done' | 'dismissed' | null) => void
}) {
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-medium text-slate-900">{rec.title}</p>
          <StatusBadge tone={IMPACT_TONE[rec.impact]}>{IMPACT_LABELS[rec.impact]}</StatusBadge>
          <StatusBadge tone="neutral">{EFFORT_LABELS[rec.effort]}</StatusBadge>
        </div>
        <p className="mt-1 text-sm break-words text-slate-600">{rec.detail}</p>
        <Link to={rec.link} className="mt-1 inline-block text-xs font-medium text-indigo-700 hover:underline">
          Open {MODULE_LABELS[rec.module]}
        </Link>
      </div>
      <div className="flex shrink-0 gap-2">
        {view === 'open' ? (
          <>
            <Button size="sm" onClick={() => onChange('done')} disabled={busy} aria-label={`Mark “${rec.title}” as done`}>
              Done
            </Button>
            <Button size="sm" variant="ghost" onClick={() => onChange('dismissed')} disabled={busy} aria-label={`Dismiss “${rec.title}”`}>
              Dismiss
            </Button>
          </>
        ) : (
          <Button size="sm" variant="secondary" onClick={() => onChange(null)} disabled={busy} aria-label={`Reopen “${rec.title}”`}>
            Reopen
          </Button>
        )}
      </div>
    </li>
  )
}

export function RecommendationsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === searchParams.get('project')) ?? null

  const bundle = useLoad(selected?.id ?? null, () => (selected ? loadProjectBundle(selected) : Promise.reject(new Error('no project'))))
  const states = useLoad(selected?.id ?? null, () => listRecommendationStates(selected?.id ?? ''))

  const [view, setView] = useState<RecView>('open')
  const [moduleFilter, setModuleFilter] = useState<'all' | RecModule>('all')
  const [overrides, setOverrides] = useState<Record<string, 'done' | 'dismissed' | null>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const recs = useMemo(() => (selected && bundle.value ? buildRecommendations(selected, bundle.value) : null), [selected, bundle.value])
  const effectiveStates = useMemo(() => {
    const map = new Map<string, Pick<RecommendationStateRow, 'rec_key' | 'status'>>()
    for (const state of states.value?.data ?? []) map.set(state.rec_key, state)
    for (const [key, status] of Object.entries(overrides)) {
      if (status === null) map.delete(key)
      else map.set(key, { rec_key: key, status })
    }
    return [...map.values()]
  }, [states.value, overrides])
  const groups = useMemo(() => (recs ? splitByState(recs, effectiveStates) : null), [recs, effectiveStates])
  const visible = groups ? groups[view].filter((rec) => moduleFilter === 'all' || rec.module === moduleFilter) : []

  async function change(rec: Recommendation, status: 'done' | 'dismissed' | null) {
    if (!selected) return
    setBusyKey(rec.key)
    setActionError(null)
    const result = await setRecommendationState(selected.id, rec.key, status)
    setBusyKey(null)
    if (result.data === null) {
      setActionError(result.error)
      return
    }
    setOverrides((current) => ({ ...current, [rec.key]: status }))
  }

  const header = (
    <PageHeader
      title="Recommendations"
      description="Everything the other modules found for a project, turned into one prioritised to-do list. Highest impact and quickest wins first."
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
          <EmptyState icon="lightbulb" title="Create a project first" description="Recommendations are made per project." action={<ButtonLink to="/projects/new">New project</ButtonLink>} />
        </Card>
      </>
    )
  }

  const modulesPresent = recs ? [...new Set(recs.map((rec) => rec.module))] : []

  return (
    <>
      {header}
      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="recs-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(id) => {
              setOverrides({})
              setView('open')
              setModuleFilter('all')
              const next = new URLSearchParams(searchParams)
              if (id) next.set('project', id)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
          {selected ? (
            <div className="min-w-[12rem]">
              <label htmlFor="recs-module" className="mb-1 block text-sm font-medium text-slate-800">
                Module
              </label>
              <select id="recs-module" className={controlClasses(false)} value={moduleFilter} onChange={(event) => setModuleFilter(event.target.value as 'all' | RecModule)}>
                <option value="all">All modules</option>
                {modulesPresent.map((module) => (
                  <option key={module} value={module}>
                    {MODULE_LABELS[module]}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {selected ? (
            <Button variant="secondary" onClick={() => bundle.reload()} loading={bundle.loading && bundle.value !== null}>
              Refresh
            </Button>
          ) : null}
        </div>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="lightbulb" title="Choose a project" description="Pick a project above to see what to work on next." />
        </Card>
      ) : !groups || (states.loading && !states.value) ? (
        <LoadingState label="Gathering findings from every module…" />
      ) : (
        <>
          {bundle.value && bundle.value.problems.length > 0 ? (
            <Alert variant="warning" className="mb-6" title="Some data could not be loaded">
              <ul className="list-disc pl-4">
                {bundle.value.problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {states.value?.error ? (
            <Alert variant="warning" className="mb-6">
              {states.value.error}
            </Alert>
          ) : null}
          {actionError ? (
            <Alert variant="error" className="mb-6" title="Could not update the recommendation">
              {actionError}
            </Alert>
          ) : null}

          <div role="tablist" aria-label="Recommendation status" className="mb-4 flex gap-2">
            {(Object.keys(VIEW_LABELS) as RecView[]).map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={view === key}
                onClick={() => setView(key)}
                className={[
                  'rounded-lg px-3 py-1.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-indigo-600',
                  view === key ? 'bg-indigo-600 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50',
                ].join(' ')}
              >
                {VIEW_LABELS[key]} ({groups[key].length})
              </button>
            ))}
          </div>

          <Card as="section" aria-label={VIEW_LABELS[view]}>
            {visible.length === 0 ? (
              <EmptyState
                icon="check"
                title={view === 'open' ? 'Nothing left to do here' : `Nothing ${VIEW_LABELS[view].toLowerCase()} yet`}
                description={view === 'open' ? 'Crawl again after making changes to check for anything new.' : 'Recommendations you mark appear here.'}
              />
            ) : (
              <ol className="divide-y divide-slate-100" aria-label="Recommendations">
                {visible.map((rec) => (
                  <RecItem key={rec.key} rec={rec} view={view} busy={busyKey === rec.key} onChange={(status) => void change(rec, status)} />
                ))}
              </ol>
            )}
          </Card>
          <p className="mt-4 text-xs text-slate-500">
            Recommendations are recalculated from the latest data each time; marking one done does not hide it from the module itself. If a
            problem still shows after you fixed it, crawl again or update the details.
          </p>
        </>
      )}
    </>
  )
}
