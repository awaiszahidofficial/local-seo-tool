import { Navigate, useParams } from 'react-router-dom'
import { ModulePlaceholder } from '../components/ModulePlaceholder'
import { ButtonLink } from '../components/ui/Button'
import { Card } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { getImplementedPath, getModule } from '../lib/modules'

/** Resolves `/modules/:moduleId` against the static module map; unknown ids get a safe fallback. */
export function ModulePage() {
  const { moduleId } = useParams()
  const module = getModule(moduleId)

  // Built modules have their own page; keep old /modules/<id> links working.
  const implementedPath = module ? getImplementedPath(module.id) : null
  if (implementedPath) return <Navigate to={implementedPath} replace />

  if (!module) {
    return (
      <>
        <PageHeader title="Module not found" />
        <Card>
          <EmptyState
            icon="alert"
            title="That module does not exist"
            description="The address may be mistyped. Use the sidebar to open one of the planned modules."
            action={
              <div className="flex gap-3">
                <ButtonLink to="/" variant="secondary">
                  Back to overview
                </ButtonLink>
                <ButtonLink to="/projects" variant="ghost">
                  Go to projects
                </ButtonLink>
              </div>
            }
          />
        </Card>
      </>
    )
  }

  return <ModulePlaceholder module={module} />
}
