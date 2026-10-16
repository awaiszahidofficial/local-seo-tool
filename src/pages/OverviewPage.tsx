import { Link } from 'react-router-dom'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { LoadingState } from '../components/ui/Spinner'
import { PageHeader } from '../components/ui/PageHeader'
import { useProjectList } from '../hooks/useProjectList'
import { formatDate } from '../lib/format'
import { MODULE_IDS, MODULES, getImplementedPath, modulePath } from '../lib/modules'
import { formatUrlForDisplay } from '../lib/url'

export function OverviewPage() {
  const { projects, loading, error, reload } = useProjectList()

  return (
    <>
      <PageHeader
        title="Overview"
        description="A snapshot of your workspace. Everything shown here comes from your saved projects."
        actions={
          projects && projects.length > 0 ? (
            <ButtonLink to="/projects/new">New project</ButtonLink>
          ) : undefined
        }
      />

      {loading ? <LoadingState label="Loading your projects…" /> : null}

      {error ? (
        <Alert variant="error" title="Could not load your projects">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {projects && projects.length === 0 ? (
        <Card>
          <EmptyState
            title="Create your first project"
            description="A project represents one client website. Add its details to get started — every analysis module works on a project."
            action={<ButtonLink to="/projects/new">Create project</ButtonLink>}
          />
        </Card>
      ) : null}

      {projects && projects.length > 0 ? (
        <div className="space-y-6">
          <dl className="grid gap-4 sm:grid-cols-2">
            <Card className="p-5">
              <dt className="text-sm font-medium text-slate-600">Projects</dt>
              <dd className="mt-1 text-3xl font-semibold text-slate-900">{projects.length}</dd>
            </Card>
            <Card className="p-5">
              <dt className="text-sm font-medium text-slate-600">Most recently added</dt>
              <dd className="mt-1 truncate text-lg font-semibold text-slate-900">
                {projects[0]?.name ?? '—'}
              </dd>
              <dd className="text-sm text-slate-600">{formatDate(projects[0]?.created_at)}</dd>
            </Card>
          </dl>

          <Card as="section" aria-labelledby="recent-projects">
            <CardHeader
              id="recent-projects"
              title="Recent projects"
              action={
                <Link to="/projects" className="text-sm font-medium text-indigo-700 hover:underline">
                  View all
                </Link>
              }
            />
            <ul className="divide-y divide-slate-100">
              {projects.slice(0, 5).map((project) => (
                <li key={project.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      to={`/projects/${project.id}`}
                      className="block truncate text-sm font-medium text-slate-900 hover:text-indigo-700 hover:underline"
                    >
                      {project.name}
                    </Link>
                    <p className="truncate text-sm text-slate-600">{formatUrlForDisplay(project.website_url)}</p>
                  </div>
                  <span className="shrink-0 text-sm text-slate-500">{formatDate(project.created_at)}</span>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      ) : null}

      <Card as="section" aria-labelledby="analysis-modules" className="mt-6">
        <CardHeader id="analysis-modules" title="Analysis modules" description="Pick a module, then choose a project inside it." />
        <ul className="grid gap-px bg-slate-100 sm:grid-cols-2">
          {MODULE_IDS.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 bg-white px-5 py-3">
              <Link to={getImplementedPath(id) ?? modulePath(id)} className="text-sm font-medium text-slate-800 hover:text-indigo-700 hover:underline">
                {MODULES[id].name}
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </>
  )
}
