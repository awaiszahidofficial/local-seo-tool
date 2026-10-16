import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Icon } from '../components/icons'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { StatusBadge, type BadgeTone } from '../components/ui/StatusBadge'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { FieldFrame } from '../components/ui/Field'
import { controlClasses } from '../components/ui/fieldStyles'
import { useLatestCrawl } from '../hooks/useLatestCrawl'
import { useProjectList } from '../hooks/useProjectList'
import {
  EMPTY_GBP_FORM,
  getGbpProfile,
  profileToFormValues,
  saveGbpProfile,
  validateGbpForm,
  type GbpFormErrors,
  type GbpFormField,
  type GbpFormValues,
  type TriState,
} from '../lib/gbp'
import { auditGbp, type GbpAudit, type GbpCheck, type GbpStatus } from '../lib/gbpAudit'
import { formatDateTime } from '../lib/format'
import type { GbpProfileRow, ProjectRow } from '../types/database'

const STATUS_BADGE: Record<GbpStatus, { tone: BadgeTone; label: string }> = {
  pass: { tone: 'success', label: 'Pass' },
  warn: { tone: 'warning', label: 'Improve' },
  fail: { tone: 'danger', label: 'Fix' },
  missing: { tone: 'planned', label: 'Not entered' },
  info: { tone: 'neutral', label: 'Note' },
}

// ---- Loading the saved profile --------------------------------------------------------------

type ProfileState = { key: string; profile: GbpProfileRow | null; error: string | null }

function useGbpProfile(projectId: string | null) {
  const [state, setState] = useState<ProfileState | null>(null)
  const key = projectId ?? ''

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void getGbpProfile(projectId).then((result) => {
      if (!cancelled) setState({ key: projectId, profile: result.data, error: result.error })
    })
    return () => {
      cancelled = true
    }
  }, [projectId])

  const current = state !== null && state.key === key ? state : null
  return {
    loading: projectId !== null && current === null,
    profile: current?.profile ?? null,
    error: current?.error ?? null,
    setProfile: (profile: GbpProfileRow) => setState({ key, profile, error: null }),
  }
}

// ---- Form -----------------------------------------------------------------------------------

function TriSelect({ id, label, value, onChange, hint }: { id: string; label: string; value: TriState; onChange: (value: TriState) => void; hint?: ReactNode }) {
  return (
    <FieldFrame id={id} label={label} hint={hint}>
      {(controlProps) => (
        <select {...controlProps} className={controlClasses(false)} value={value} onChange={(event) => onChange(event.target.value as TriState)}>
          <option value="">Not checked</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      )}
    </FieldFrame>
  )
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <fieldset className="border-t border-slate-100 px-5 py-5 first:border-t-0">
      <legend className="sr-only">{title}</legend>
      <h3 className="text-sm font-semibold text-slate-900" aria-hidden="true">
        {title}
      </h3>
      {description ? <p className="mt-0.5 text-xs text-slate-600">{description}</p> : null}
      <div className="mt-4 grid gap-4 md:grid-cols-2">{children}</div>
    </fieldset>
  )
}

function fromProject(project: ProjectRow): GbpFormValues {
  return {
    ...EMPTY_GBP_FORM,
    business_name: project.business_name ?? project.name,
    primary_category: project.business_type ?? '',
    website_url: project.website_url,
    services: (project.services ?? []).join('\n'),
    gbp_service_areas: (project.service_areas ?? []).join('\n'),
  }
}

type ProfileFormProps = {
  project: ProjectRow
  profile: GbpProfileRow | null
  onSaved: (profile: GbpProfileRow) => void
}

function ProfileForm({ project, profile, onSaved }: ProfileFormProps) {
  const [values, setValues] = useState<GbpFormValues>(() => profileToFormValues(profile))
  const [errors, setErrors] = useState<GbpFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  function set<K extends GbpFormField>(field: K, value: GbpFormValues[K]) {
    setSaved(false)
    setValues((current) => ({ ...current, [field]: value }))
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }))
  }

  const text = (field: Exclude<GbpFormField, 'service_area_business'>, label: string, extra: Partial<Parameters<typeof TextField>[0]> = {}) => (
    <TextField
      id={`gbp-${field}`}
      label={label}
      value={values[field] as string}
      error={errors[field]}
      onChange={(event) => set(field, event.target.value as never)}
      {...extra}
    />
  )
  const tri = (field: GbpFormField, label: string, hint?: string) => (
    <TriSelect id={`gbp-${field}`} label={label} value={values[field] as TriState} onChange={(value) => set(field, value as never)} hint={hint} />
  )
  const lines = (field: GbpFormField, label: string, hint: string, placeholder?: string) => (
    <TextAreaField
      id={`gbp-${field}`}
      label={label}
      rows={4}
      value={values[field] as string}
      error={errors[field]}
      hint={hint}
      placeholder={placeholder}
      onChange={(event) => set(field, event.target.value as never)}
    />
  )

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    setSaveError(null)
    setSaved(false)
    const result = validateGbpForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      setSaveError('Some details need fixing. See the highlighted fields.')
      return
    }
    setErrors({})
    setSaving(true)
    const response = await saveGbpProfile(project.id, result.data)
    setSaving(false)
    if (response.data === null) {
      setSaveError(response.error)
      return
    }
    setSaved(true)
    setValues(profileToFormValues(response.data))
    onSaved(response.data)
  }

  const descriptionLength = values.description.trim().length
  const isEmpty = JSON.stringify(values) === JSON.stringify(EMPTY_GBP_FORM)

  return (
    <Card as="section" aria-labelledby="gbp-details">
      <CardHeader
        id="gbp-details"
        title="Profile details"
        description="Copy these from the Google Business Profile (search the business on Google Maps, or open it in Business Profile Manager). Leave anything you have not checked empty."
        action={
          isEmpty ? (
            <Button variant="secondary" onClick={() => setValues(fromProject(project))}>
              Start from project details
            </Button>
          ) : undefined
        }
      />
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <Section title="Basics">
          {tri('verified', 'Profile is verified')}
          {text('business_name', 'Business name on the profile')}
          {tri('has_hours', 'Opening hours set')}
          {tri('has_special_hours', 'Holiday (special) hours set')}
          {text('attributes_count', 'Number of attributes set', { inputMode: 'numeric', hint: 'Under “Edit profile” → More' })}
          {tri('has_booking_link', 'Booking or quote link set')}
        </Section>

        <Section title="Categories, services and products">
          {text('primary_category', 'Primary category', { placeholder: 'Plumber' })}
          {lines('additional_categories', 'Additional categories', 'One per line. Google allows up to 9.')}
          {lines('services', 'Services listed on the profile', 'One per line.', 'Drain cleaning\nWater heater repair')}
          {text('products_count', 'Number of products', { inputMode: 'numeric' })}
        </Section>

        <Section title="Contact details and location">
          {text('phone', 'Primary phone', { inputMode: 'tel' })}
          {text('website_url', 'Website link', { inputMode: 'url', placeholder: 'https://example.com' })}
          {text('address', 'Address', { placeholder: '12 Main St, Austin, TX 78701', hint: 'Leave empty if the address is hidden.' })}
          <div className="flex items-start gap-2 pt-7">
            <input
              id="gbp-service_area_business"
              type="checkbox"
              className="mt-0.5 size-4 rounded border-slate-300 text-indigo-600"
              checked={values.service_area_business}
              onChange={(event) => set('service_area_business', event.target.checked)}
            />
            <label htmlFor="gbp-service_area_business" className="text-sm text-slate-800">
              Service-area business (visits customers; address hidden)
            </label>
          </div>
          {values.service_area_business
            ? lines('gbp_service_areas', 'Service areas on the profile', 'One per line. Google allows up to 20.')
            : null}
        </Section>

        <Section title="Description">
          <div className="md:col-span-2">
            <TextAreaField
              id="gbp-description"
              label="Business description"
              rows={5}
              value={values.description}
              error={errors.description}
              hint={`${descriptionLength} of 750 characters`}
              onChange={(event) => set('description', event.target.value)}
            />
          </div>
        </Section>

        <Section title="Photos">
          {text('photos_count', 'Number of photos', { inputMode: 'numeric' })}
          {tri('has_logo', 'Logo set')}
          {tri('has_cover_photo', 'Cover photo set')}
        </Section>

        <Section title="Reviews">
          {text('review_count', 'Total reviews', { inputMode: 'numeric' })}
          {text('rating', 'Average rating', { inputMode: 'decimal', placeholder: '4.7' })}
          {text('reviews_last_90_days', 'Reviews in the last 90 days', { inputMode: 'numeric', hint: 'Sort reviews by “Newest” and count.' })}
          {text('reply_rate', 'Reviews with an owner reply (%)', { inputMode: 'numeric', hint: 'Roughly, from the last 20 reviews.' })}
        </Section>

        <Section title="Posts">
          {text('last_post_date', 'Date of the latest post', { type: 'date', hint: 'Leave empty if the profile has never posted.' })}
        </Section>

        <div className="space-y-3 border-t border-slate-100 px-5 py-4">
          {saveError ? (
            <Alert variant="error" title="Could not save">
              {saveError}
            </Alert>
          ) : null}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" loading={saving}>
              Save and audit
            </Button>
            {saved ? <span className="text-sm text-emerald-700">Saved. The audit above is updated.</span> : null}
          </div>
        </div>
      </form>
    </Card>
  )
}

// ---- Results --------------------------------------------------------------------------------

function CheckList({ checks, label }: { checks: readonly GbpCheck[]; label: string }) {
  return (
    <ul aria-label={label} className="divide-y divide-slate-100">
      {checks.map((check) => (
        <li key={check.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-start sm:gap-4">
          <span className="w-24 shrink-0">
            <StatusBadge tone={STATUS_BADGE[check.status].tone}>{STATUS_BADGE[check.status].label}</StatusBadge>
          </span>
          <div className="min-w-0 text-sm">
            <p className="font-medium text-slate-900">{check.label}</p>
            <p className="mt-0.5 break-words text-slate-600">{check.detail}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AuditResults({ audit, savedAt }: { audit: GbpAudit; savedAt: string }) {
  const scoreTone = audit.score === null ? 'text-slate-500' : audit.score >= 80 ? 'text-emerald-700' : audit.score >= 60 ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="mb-6 space-y-6">
      <Card as="section" aria-labelledby="gbp-summary">
        <CardHeader id="gbp-summary" title="Profile score" description={`Details last saved ${formatDateTime(savedAt)}.`} />
        <dl className="grid grid-cols-2 gap-px bg-slate-100 sm:grid-cols-5">
          <div className="bg-white px-5 py-4">
            <dt className="text-xs font-medium text-slate-600">Score</dt>
            <dd className={`mt-1 text-2xl font-semibold tabular-nums ${scoreTone}`}>{audit.score === null ? '—' : `${audit.score}/100`}</dd>
          </div>
          {(
            [
              ['Passed', audit.counts.pass],
              ['To improve', audit.counts.warn],
              ['To fix', audit.counts.fail],
              ['Not entered', audit.counts.missing],
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="bg-white px-5 py-4">
              <dt className="text-xs font-medium text-slate-600">{label}</dt>
              <dd className="mt-1 text-2xl font-semibold text-slate-900 tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        {audit.missing.length > 0 ? (
          <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
            The score covers only what was entered. Still to fill in: {audit.missing.join(', ')}.
          </p>
        ) : null}
      </Card>

      {audit.topFixes.length > 0 ? (
        <Card as="section" aria-labelledby="gbp-fixes">
          <CardHeader id="gbp-fixes" title="What to work on first" description="Fixes first, then improvements, most important first." />
          <CheckList checks={audit.topFixes.slice(0, 8)} label="Top fixes" />
        </Card>
      ) : audit.score !== null ? (
        <Alert variant="success">Everything entered passes.</Alert>
      ) : null}

      {audit.groups.map((group) => (
        <details key={group.group} className="group rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-indigo-600">
            <Icon name="arrowLeft" className="size-4 shrink-0 -rotate-90 text-slate-500 transition-transform group-open:rotate-90" />
            <span className="flex-1 font-medium text-slate-900">{group.label}</span>
            <span className="text-xs text-slate-600">
              {group.checks.filter((check) => check.status === 'pass').length} of {group.checks.length} passed
            </span>
          </summary>
          <CheckList checks={group.checks} label={group.label} />
        </details>
      ))}

      {!audit.crawlUsed ? (
        <p className="text-xs text-slate-600">
          Crawl the website to compare its phone number, name and address with the profile.
        </p>
      ) : null}
    </div>
  )
}

// ---- Page -----------------------------------------------------------------------------------

export function GbpAuditPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const requestedId = searchParams.get('project')
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === requestedId) ?? null
  const profileState = useGbpProfile(selected?.id ?? null)
  const crawlState = useLatestCrawl(selected?.id ?? null, { light: true })
  const profile = profileState.profile

  const crawlPages = crawlState.crawl?.status === 'completed' ? crawlState.pages : null
  const audit = useMemo(
    () => (selected && profile ? auditGbp(selected, profile, crawlPages) : null),
    [selected, profile, crawlPages],
  )

  const header = (
    <PageHeader
      title="Google Business Profile Audit"
      description="Enter a client’s Google Business Profile details to score its completeness, reviews and activity, and check it matches the website."
    />
  )

  if (projectsState.loading) {
    return (
      <>
        {header}
        <LoadingState label="Loading your projects…" />
      </>
    )
  }
  if (projectsState.error) {
    return (
      <>
        {header}
        <Alert variant="error" title="Could not load your projects">
          {projectsState.error}
        </Alert>
      </>
    )
  }
  if (!projects || projects.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState
            icon="pin"
            title="Create a project to audit its Business Profile"
            description="Each project holds one Google Business Profile."
            action={<ButtonLink to="/projects/new">New project</ButtonLink>}
          />
        </Card>
      </>
    )
  }

  return (
    <>
      {header}

      <Card className="mb-6">
        <div className="flex flex-wrap items-end gap-4 p-5">
          <ProjectSelect
            id="gbp-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(projectId) => {
              const next = new URLSearchParams(searchParams)
              if (projectId) next.set('project', projectId)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-600">
          Details are entered by hand, so the audit is as current as the last time you updated them. Website checks use
          the latest crawl.
        </p>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="pin" title="Choose a project" description="Pick a project above to enter and audit its Business Profile." />
        </Card>
      ) : profileState.loading ? (
        <LoadingState label="Loading the saved profile…" />
      ) : profileState.error ? (
        <Alert variant="error" title="Could not load the profile">
          {profileState.error}
        </Alert>
      ) : (
        <>
          {audit && profile ? (
            <AuditResults audit={audit} savedAt={profile.updated_at} />
          ) : (
            <Alert variant="info" className="mb-6" title="No profile details yet">
              Fill in what you can below and save. You can come back and add the rest later.{' '}
              {!selected.business_type || !selected.location ? (
                <>
                  For better checks, also set the{' '}
                  <Link to={`/projects/${selected.id}/edit`} className="font-medium underline">
                    project’s location and business type
                  </Link>
                  .
                </>
              ) : null}
            </Alert>
          )}
          <ProfileForm key={selected.id} project={selected} profile={profile} onSaved={profileState.setProfile} />
        </>
      )}
    </>
  )
}
