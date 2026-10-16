import { useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { TextField } from '../components/ui/TextField'
import { useLoad } from '../hooks/useLoad'
import { useProjectList } from '../hooks/useProjectList'
import { formatDateTime } from '../lib/format'
import { loadProjectBundle } from '../lib/projectBundle'
import { listRecommendationStates } from '../lib/recommendationStates'
import { buildSnapshot, defaultReportTitle, deleteReport, listReports, saveReport, type ReportListItem } from '../lib/reportSnapshot'
import type { ProjectRow } from '../types/database'

function NewReport({ project, onCreated }: { project: ProjectRow; onCreated: (id: string) => void }) {
  const [title, setTitle] = useState(() => defaultReportTitle(project))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    const [bundle, states] = await Promise.all([loadProjectBundle(project), listRecommendationStates(project.id)])
    const snapshot = buildSnapshot(project, bundle, states.data ?? [])
    const result = await saveReport(project.id, title, snapshot)
    setBusy(false)
    if (result.data === null) {
      setError(result.error)
      return
    }
    onCreated(result.data.id)
  }

  return (
    <Card as="section" aria-labelledby="new-report" className="mb-6">
      <CardHeader
        id="new-report"
        title="Create a report"
        description="Takes a snapshot of every module right now: search performance, Business Profile, website health, coverage, listings and priorities. Saved reports never change, so you can compare month to month."
      />
      <form onSubmit={(event) => void create(event)} className="flex flex-wrap items-end gap-3 p-5">
        <div className="min-w-[16rem] flex-1">
          <TextField id="report-title" label="Report title" value={title} maxLength={200} onChange={(event) => setTitle(event.target.value)} />
        </div>
        <Button type="submit" loading={busy} disabled={!title.trim()}>
          {busy ? 'Building report…' : 'Create report'}
        </Button>
      </form>
      {error ? (
        <div className="px-5 pb-5">
          <Alert variant="error" title="Could not create the report">
            {error}
          </Alert>
        </div>
      ) : null}
    </Card>
  )
}

export function ReportsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const projectsState = useProjectList()
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === searchParams.get('project')) ?? null
  const reports = useLoad(selected?.id ?? null, () => listReports(selected?.id ?? ''))

  const [pendingDelete, setPendingDelete] = useState<ReportListItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteReport(pendingDelete.id)
    setDeleting(false)
    if (result.data === null) {
      setDeleteError(result.error)
      return
    }
    setPendingDelete(null)
    reports.reload()
  }

  const header = (
    <PageHeader title="Reports" description="Create a client-ready report for a project, print it or save it as a PDF, and keep a history of past reports." />
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
          <EmptyState icon="report" title="Create a project first" description="Reports are made per project." action={<ButtonLink to="/projects/new">New project</ButtonLink>} />
        </Card>
      </>
    )
  }

  const rows = reports.value?.data ?? null

  return (
    <>
      {header}
      <Card className="mb-6">
        <div className="p-5">
          <ProjectSelect
            id="reports-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(id) => {
              const next = new URLSearchParams(searchParams)
              if (id) next.set('project', id)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
        </div>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="report" title="Choose a project" description="Pick a project above to create or view its reports." />
        </Card>
      ) : (
        <>
          <NewReport key={selected.id} project={selected} onCreated={(id) => navigate(`/reports/${id}`)} />

          <Card as="section" aria-labelledby="saved-reports">
            <CardHeader id="saved-reports" title="Saved reports" />
            {reports.loading && !rows ? (
              <LoadingState label="Loading reports…" />
            ) : reports.value?.error ? (
              <div className="p-5">
                <Alert variant="error" title="Could not load reports">
                  {reports.value.error}
                </Alert>
              </div>
            ) : !rows || rows.length === 0 ? (
              <EmptyState icon="report" title="No reports yet" description="Create the first one above." />
            ) : (
              <ul className="divide-y divide-line-soft" aria-label="Saved reports">
                {rows.map((report) => (
                  <li key={report.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                    <div className="min-w-0 flex-1">
                      <Link to={`/reports/${report.id}`} className="font-medium text-accent-ink hover:underline">
                        {report.title}
                      </Link>
                      <p className="text-xs text-ink-3">{formatDateTime(report.created_at)}</p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete ${report.title}`}
                      onClick={() => {
                        setDeleteError(null)
                        setPendingDelete(report)
                      }}
                    >
                      Delete
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this report?"
        confirmLabel="Delete report"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          <strong className="font-semibold text-ink">{pendingDelete?.title}</strong> will be permanently deleted.
        </p>
      </ConfirmDialog>
    </>
  )
}
