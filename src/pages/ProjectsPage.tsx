import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Icon } from '../components/icons'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { Table, Td, Th } from '../components/ui/Table'
import { useFlashNotice } from '../hooks/useFlashNotice'
import { useProjectList } from '../hooks/useProjectList'
import { formatDate } from '../lib/format'
import { deleteProject } from '../lib/projects'
import { formatUrlForDisplay, getSafeHttpUrl } from '../lib/url'
import type { ProjectRow } from '../types/database'

function WebsiteLink({ url }: { url: string }) {
  const href = getSafeHttpUrl(url)
  const label = formatUrlForDisplay(url)
  if (!href) return <span className="break-all">{label}</span>
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 break-all text-accent-ink hover:underline"
    >
      {label}
      <Icon name="external" className="size-3.5 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

function RowActions({ project, onDelete }: { project: ProjectRow; onDelete: (project: ProjectRow) => void }) {
  return (
    <div className="flex items-center gap-2">
      <ButtonLink
        to={`/projects/${project.id}/edit`}
        variant="secondary"
        size="sm"
        aria-label={`Edit ${project.name}`}
      >
        <Icon name="pencil" className="size-4" />
        Edit
      </ButtonLink>
      <Button variant="ghost" size="sm" onClick={() => onDelete(project)} aria-label={`Delete ${project.name}`}>
        <Icon name="trash" className="size-4" />
        Delete
      </Button>
    </div>
  )
}

export function ProjectsPage() {
  const { projects, loading, error, reload } = useProjectList()
  const [notice, setNotice] = useFlashNotice()
  const [pendingDelete, setPendingDelete] = useState<ProjectRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  function requestDelete(project: ProjectRow) {
    setDeleteError(null)
    setPendingDelete(project)
  }

  function cancelDelete() {
    if (deleting) return
    setPendingDelete(null)
    setDeleteError(null)
  }

  async function confirmDelete() {
    if (!pendingDelete || deleting) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteProject(pendingDelete.id)
    setDeleting(false)
    if (result.error) {
      setDeleteError(result.error)
      return
    }
    setNotice(`“${pendingDelete.name}” was deleted.`)
    setPendingDelete(null)
    reload()
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project represents a client website and business you are working on."
        actions={<ButtonLink to="/projects/new">New project</ButtonLink>}
      />

      {notice ? (
        <Alert variant="success" className="mb-4">
          {notice}
        </Alert>
      ) : null}

      {loading ? <LoadingState label="Loading projects…" /> : null}

      {error ? (
        <Alert variant="error" title="Could not load projects">
          <p>{error}</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={reload}>
            Try again
          </Button>
        </Alert>
      ) : null}

      {projects && projects.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            description="Create a project for your first client website to start organizing your local SEO work."
            action={<ButtonLink to="/projects/new">Create project</ButtonLink>}
          />
        </Card>
      ) : null}

      {projects && projects.length > 0 ? (
        <>
          {/* Table on wider screens */}
          <Card className="hidden overflow-hidden md:block">
            <Table aria-label="Projects">
              <thead>
                <tr>
                  <Th>Project</Th>
                  <Th>Website</Th>
                  <Th>Location</Th>
                  <Th>Created</Th>
                  <Th>
                    <span className="sr-only">Actions</span>
                  </Th>
                </tr>
              </thead>
              <tbody>
                {projects.map((project) => (
                  <tr key={project.id} className="hover:bg-surface-2">
                    <Td>
                      <Link
                        to={`/projects/${project.id}`}
                        className="font-medium text-ink hover:text-accent-ink hover:underline"
                      >
                        {project.name}
                      </Link>
                      {project.business_name ? (
                        <p className="text-ink-2">{project.business_name}</p>
                      ) : null}
                    </Td>
                    <Td>
                      <WebsiteLink url={project.website_url} />
                    </Td>
                    <Td>{project.location ?? '—'}</Td>
                    <Td className="whitespace-nowrap">{formatDate(project.created_at)}</Td>
                    <Td>
                      <RowActions project={project} onDelete={requestDelete} />
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          {/* Cards on small screens */}
          <ul className="space-y-3 md:hidden" aria-label="Projects">
            {projects.map((project) => (
              <li key={project.id}>
                <Card className="p-4">
                  <Link
                    to={`/projects/${project.id}`}
                    className="font-medium text-ink hover:text-accent-ink hover:underline"
                  >
                    {project.name}
                  </Link>
                  {project.business_name ? <p className="text-sm text-ink-2">{project.business_name}</p> : null}
                  <dl className="mt-3 space-y-1 text-sm">
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-3">Website</dt>
                      <dd className="min-w-0">
                        <WebsiteLink url={project.website_url} />
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-3">Location</dt>
                      <dd>{project.location ?? '—'}</dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-20 shrink-0 text-ink-3">Created</dt>
                      <dd>{formatDate(project.created_at)}</dd>
                    </div>
                  </dl>
                  <div className="mt-4">
                    <RowActions project={project} onDelete={requestDelete} />
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this project?"
        confirmLabel="Delete project"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={cancelDelete}
      >
        <p>
          <strong className="font-semibold text-ink">{pendingDelete?.name}</strong> will be permanently
          deleted. This cannot be undone.
        </p>
      </ConfirmDialog>
    </>
  )
}
