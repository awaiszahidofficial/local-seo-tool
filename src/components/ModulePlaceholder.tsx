import type { ModuleMeta } from '../lib/modules'
import { ButtonLink } from './ui/Button'
import { Alert } from './ui/Alert'
import { Card, CardHeader } from './ui/Card'
import { PageHeader } from './ui/PageHeader'
import { StatusBadge } from './ui/StatusBadge'

/** Reusable page for modules that are planned but not implemented in this phase. */
export function ModulePlaceholder({ module }: { module: ModuleMeta }) {
  return (
    <>
      <PageHeader
        title={module.name}
        description={module.summary}
        actions={<StatusBadge tone="planned">Planned</StatusBadge>}
      />

      <Alert variant="info" title="Not implemented in this phase">
        {module.name} is planned for a future phase of Local SEO Workbench. Nothing on this page is functional
        yet, and no data is collected or analyzed for it.
      </Alert>

      <Card as="section" aria-labelledby="planned-capabilities" className="mt-6">
        <CardHeader
          id="planned-capabilities"
          title="What this module is intended to do"
          description="Intended capabilities, subject to change. None of these are available today."
        />
        <ul className="list-disc space-y-2 px-9 py-5 text-sm text-ink-2">
          {module.intendedFeatures.map((feature) => (
            <li key={feature}>{feature}</li>
          ))}
        </ul>
      </Card>

      <div className="mt-6 flex flex-wrap gap-3">
        <ButtonLink to="/" variant="secondary">
          Back to overview
        </ButtonLink>
        <ButtonLink to="/projects" variant="ghost">
          Go to projects
        </ButtonLink>
      </div>
    </>
  )
}
