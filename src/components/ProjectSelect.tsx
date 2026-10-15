import { controlClasses } from './ui/fieldStyles'
import { formatUrlForDisplay } from '../lib/url'
import type { ProjectRow } from '../types/database'

type ProjectSelectProps = {
  id: string
  projects: readonly ProjectRow[]
  value: string
  disabled?: boolean
  onChange: (projectId: string) => void
}

/** Labelled project dropdown shared by the analysis modules. */
export function ProjectSelect({ id, projects, value, disabled, onChange }: ProjectSelectProps) {
  return (
    <div className="min-w-[16rem] flex-1">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-800">
        Project
      </label>
      <select
        id={id}
        className={controlClasses(false)}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Choose a project…</option>
        {projects.map((project) => (
          <option key={project.id} value={project.id}>
            {project.name} — {formatUrlForDisplay(project.website_url, 40)}
          </option>
        ))}
      </select>
    </div>
  )
}
