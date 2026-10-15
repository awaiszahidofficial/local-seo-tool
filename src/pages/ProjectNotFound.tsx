import { ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'

/** Shown for missing projects and for projects the user cannot access (indistinguishable by design). */
export function ProjectNotFound() {
  return (
    <Card>
      <EmptyState
        icon="alert"
        title="Project not found"
        description="This project does not exist, or you do not have access to it."
        action={<ButtonLink to="/projects">Back to projects</ButtonLink>}
      />
    </Card>
  )
}
