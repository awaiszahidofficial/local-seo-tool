import { useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/icons'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { useFlashNotice } from '../hooks/useFlashNotice'
import { useProject } from '../hooks/useProject'
import { formatDate } from '../lib/format'
import { deleteProject } from '../lib/projects'
import { getSafeHttpUrl } from '../lib/url'
import { ProjectNotFound } from './ProjectNotFound'

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="px-5 py-4 sm:grid sm:grid-cols-3 sm:gap-4">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="mt-1 min-w-0 text-sm break-words text-slate-900 sm:col-span-2 sm:mt-0">{children}</dd>
    </div>
  )
}

const NOT_PROVIDED = <span className="text-slate-500">Not provided</span>

export function ProjectDetailPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { project, loading, error, notFound } = useProject(projectId)
  const [notice] = useFlashNotice()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  async function handleDelete() {
    if (!project || deleting) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteProject(project.id)
    if (result.error) {
      setDeleting(false)
      setDeleteError(result.error)
      return
    }
    navigate('/projects', { replace: true, state: { notice: `“${project.name}” was deleted.` } })
  }

  if (loading) return <LoadingState label="Loading project…" />
  if (error) {
    return (
      <Alert variant="error" title="Could not load this project">
        {error}
      </Alert>
    )
  }
  if (notFound || !project) return <ProjectNotFound />

  const websiteHref = getSafeHttpUrl(project.website_url)

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/projects" className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline">
            <Icon name="arrowLeft" className="size-4" />
            Projects
          </Link>
        }
        title={project.name}
        description={project.business_name ?? undefined}
        actions={
          <>
            <ButtonLink to={`/crawler?project=${project.id}`} variant="secondary">
              <Icon name="globe" className="size-4" />
              Crawl website
            </ButtonLink>
            <ButtonLink to={`/projects/${project.id}/edit`} variant="secondary">
              <Icon name="pencil" className="size-4" />
              Edit
            </ButtonLink>
            <Button
              variant="ghost"
              onClick={() => {
                setDeleteError(null)
                setConfirmOpen(true)
              }}
            >
              <Icon name="trash" className="size-4" />
              Delete
            </Button>
          </>
        }
      />

      {notice ? (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}

      <Card as="section" aria-labelledby="project-details" className="max-w-3xl">
        <CardHeader id="project-details" title="Project details" />
        <dl className="divide-y divide-slate-100">
          <Detail label="Website">
            {websiteHref ? (
              <a
                href={websiteHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-700 hover:underline"
              >
                <span className="break-all">{project.website_url}</span>
                <Icon name="external" className="size-3.5 shrink-0" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : (
              <span className="break-all">{project.website_url}</span>
            )}
          </Detail>
          <Detail label="Business name">{project.business_name ?? NOT_PROVIDED}</Detail>
          <Detail label="Primary location">{project.location ?? NOT_PROVIDED}</Detail>
          <Detail label="Business type">{project.business_type ?? NOT_PROVIDED}</Detail>
          <Detail label="Notes">
            {project.notes ? <p className="whitespace-pre-wrap">{project.notes}</p> : NOT_PROVIDED}
          </Detail>
          <Detail label="Created">{formatDate(project.created_at)}</Detail>
          <Detail label="Last updated">{formatDate(project.updated_at)}</Detail>
        </dl>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete this project?"
        confirmLabel="Delete project"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void handleDelete()}
        onCancel={() => {
          if (!deleting) setConfirmOpen(false)
        }}
      >
        <p>
          <strong className="font-semibold text-slate-900">{project.name}</strong> will be permanently deleted.
          This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  )
}
