import { Link, useNavigate } from 'react-router-dom'
import { Icon } from '../components/icons'
import { ProjectForm } from '../components/ProjectForm'
import { Card } from '../components/ui/Card'
import { PageHeader } from '../components/ui/PageHeader'
import { useAuth } from '../hooks/useAuth'
import { createProject } from '../lib/projects'
import type { ProjectInput } from '../types/project'

export function ProjectNewPage() {
  const { user } = useAuth()
  const navigate = useNavigate()

  async function handleSubmit(data: ProjectInput): Promise<string | null> {
    if (!user) return 'You must be signed in to create a project.'
    const result = await createProject(user.id, data)
    if (result.error !== null) return result.error
    navigate(`/projects/${result.data.id}`, { state: { notice: 'Project created.' } })
    return null
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/projects" className="inline-flex items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
            <Icon name="arrowLeft" className="size-4" />
            Projects
          </Link>
        }
        title="New project"
        description="Add the details of the website and business you want to work on."
      />
      <Card className="max-w-3xl p-5 sm:p-6">
        <ProjectForm submitLabel="Create project" onSubmit={handleSubmit} cancelTo="/projects" />
      </Card>
    </>
  )
}
