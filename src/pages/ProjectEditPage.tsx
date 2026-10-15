import { Link, useNavigate, useParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import { ProjectForm } from '../components/ProjectForm'
import { Alert } from '../components/ui/Alert'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { useProject } from '../hooks/useProject'
import { updateProject } from '../lib/projects'
import { projectToFormValues, type ProjectInput } from '../types/project'
import { ProjectNotFound } from './ProjectNotFound'

export function ProjectEditPage() {
  const { projectId } = useParams()
  const navigate = useNavigate()
  const { project, loading, error, notFound } = useProject(projectId)

  async function handleSubmit(data: ProjectInput): Promise<string | null> {
    if (!project) return 'This project could not be loaded.'
    const result = await updateProject(project.id, data)
    if (result.error) return result.error
    navigate(`/projects/${project.id}`, { state: { notice: 'Project updated.' } })
    return null
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

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            to={`/projects/${project.id}`}
            className="inline-flex items-center gap-1 text-sm font-medium text-indigo-700 hover:underline"
          >
            <Icon name="arrowLeft" className="size-4" />
            {project.name}
          </Link>
        }
        title="Edit project"
        description="Update the details of this project."
      />
      <Card className="max-w-3xl p-5 sm:p-6">
        <ProjectForm
          initialValues={projectToFormValues(project)}
          submitLabel="Save changes"
          onSubmit={handleSubmit}
          cancelTo={`/projects/${project.id}`}
        />
      </Card>
    </>
  )
}
