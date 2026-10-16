import { useMemo, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { ProjectSelect } from '../components/ProjectSelect'
import { Alert } from '../components/ui/Alert'
import { Button, ButtonLink } from '../components/ui/Button'
import { Card, CardHeader } from '../components/ui/Card'
import { EmptyState } from '../components/ui/EmptyState'
import { FieldFrame } from '../components/ui/Field'
import { PageHeader } from '../components/ui/PageHeader'
import { LoadingState } from '../components/ui/Spinner'
import { StatusBadge, type BadgeTone } from '../components/ui/StatusBadge'
import { Table, Td, Th } from '../components/ui/Table'
import { TextAreaField } from '../components/ui/TextAreaField'
import { TextField } from '../components/ui/TextField'
import { controlClasses } from '../components/ui/fieldStyles'
import { useLoad } from '../hooks/useLoad'
import { useProjectList } from '../hooks/useProjectList'
import { formatDate } from '../lib/format'
import { getGbpProfile } from '../lib/gbp'
import {
  DIRECTORIES,
  EMPTY_LISTING_FORM,
  LISTING_STATUS_LABELS,
  TIER_LABELS,
  deleteListing,
  listListings,
  listingToForm,
  referenceNap,
  saveListing,
  summarizeListings,
  validateListingForm,
  type FieldCheck,
  type ListingCheck,
  type ListingFormErrors,
  type ListingFormValues,
  type ReferenceNap,
} from '../lib/listings'
import { getSafeHttpUrl } from '../lib/url'
import type { BusinessListingRow, ListingStatus, ProjectRow } from '../types/database'

const STATUS_TONE: Record<ListingStatus, BadgeTone> = {
  live: 'success',
  needs_update: 'warning',
  pending: 'neutral',
  not_listed: 'planned',
  duplicate: 'danger',
}

const FIELD_LABELS = { name: 'Name', address: 'Address', phone: 'Phone', website: 'Website' } as const

function FieldMark({ check, label }: { check: FieldCheck; label: string }) {
  if (check === 'match') {
    return (
      <span className="text-good" title={`${label} matches`}>
        <span aria-hidden="true">✓</span>
        <span className="sr-only">{label} matches</span>
      </span>
    )
  }
  if (check === 'mismatch') {
    return (
      <span className="font-semibold text-bad" title={`${label} differs`}>
        <span aria-hidden="true">✗</span>
        <span className="sr-only">{label} differs</span>
      </span>
    )
  }
  return (
    <span className="text-ink-3" title={check === 'no_reference' ? 'No reference value to compare' : 'Not entered'}>
      <span aria-hidden="true">—</span>
      <span className="sr-only">{label} not checked</span>
    </span>
  )
}

// ---- Form -----------------------------------------------------------------------------------

type ListingFormProps = {
  project: ProjectRow
  reference: ReferenceNap
  editing: BusinessListingRow | null
  initialDirectory: string
  onSaved: () => void
  onCancel: () => void
}

function ListingForm({ project, reference, editing, initialDirectory, onSaved, onCancel }: ListingFormProps) {
  const [values, setValues] = useState<ListingFormValues>(() =>
    editing ? listingToForm(editing) : { ...EMPTY_LISTING_FORM, directory: initialDirectory },
  )
  const [errors, setErrors] = useState<ListingFormErrors>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  function set<K extends keyof ListingFormValues>(field: K, value: ListingFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (saving) return
    const result = validateListingForm(values)
    if (!result.ok) {
      setErrors(result.errors)
      return
    }
    setErrors({})
    setSaving(true)
    setSaveError(null)
    const response = await saveListing(project.id, result.data, editing?.id)
    setSaving(false)
    if (response.data === null) {
      setSaveError(response.error)
      return
    }
    onSaved()
  }

  const directoryUrl = DIRECTORIES.find((directory) => directory.name.toLowerCase() === values.directory.trim().toLowerCase())?.addUrl

  return (
    <Card as="section" aria-labelledby="listing-form" className="mb-6">
      <CardHeader
        id="listing-form"
        title={editing ? `Edit ${editing.directory}` : 'Add a listing'}
        description="Copy the details exactly as they appear on the listing, so differences show up."
      />
      <form onSubmit={(event) => void submit(event)} noValidate className="space-y-4 p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <TextField
            id="listing-directory"
            label="Directory"
            list="directory-options"
            value={values.directory}
            error={errors.directory}
            onChange={(event) => set('directory', event.target.value)}
            hint={directoryUrl ? <a href={directoryUrl} target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">Open {values.directory} for business</a> : undefined}
          />
          <datalist id="directory-options">
            {DIRECTORIES.map((directory) => (
              <option key={directory.name} value={directory.name} />
            ))}
          </datalist>
          <FieldFrame id="listing-status" label="Status">
            {(controlProps) => (
              <select {...controlProps} className={controlClasses(false)} value={values.status} onChange={(event) => set('status', event.target.value as ListingStatus)}>
                {(Object.keys(LISTING_STATUS_LABELS) as ListingStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {LISTING_STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            )}
          </FieldFrame>
          <TextField id="listing-url" label="Listing URL" inputMode="url" value={values.listing_url} error={errors.listing_url} onChange={(event) => set('listing_url', event.target.value)} />
          <TextField id="listing-checked" label="Last checked" type="date" value={values.last_checked} error={errors.last_checked} onChange={(event) => set('last_checked', event.target.value)} />
          <TextField id="listing-name" label="Name on the listing" value={values.name} error={errors.name} onChange={(event) => set('name', event.target.value)} />
          <TextField id="listing-phone" label="Phone on the listing" inputMode="tel" value={values.phone} error={errors.phone} onChange={(event) => set('phone', event.target.value)} />
          <TextField id="listing-address" label="Address on the listing" value={values.address} error={errors.address} onChange={(event) => set('address', event.target.value)} />
          <TextField id="listing-website" label="Website on the listing" inputMode="url" value={values.website} error={errors.website} onChange={(event) => set('website', event.target.value)} />
          <div className="md:col-span-2">
            <TextAreaField id="listing-notes" label="Notes" rows={2} value={values.notes} error={errors.notes} onChange={(event) => set('notes', event.target.value)} hint="For example who manages the listing or what needs changing. Never store passwords here." />
          </div>
        </div>
        {saveError ? (
          <Alert variant="error" title="Could not save the listing">
            {saveError}
          </Alert>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={saving}>
            {editing ? 'Save changes' : 'Add listing'}
          </Button>
          <Button
            variant="secondary"
            onClick={() =>
              setValues((current) => ({
                ...current,
                name: reference.name ?? current.name,
                address: reference.address ?? current.address,
                phone: reference.phone ?? current.phone,
                website: reference.website ?? current.website,
              }))
            }
          >
            Fill in the correct details
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  )
}

// ---- Page -----------------------------------------------------------------------------------

function ListingsTable({ checks, onEdit, onDelete }: { checks: ListingCheck[]; onEdit: (listing: BusinessListingRow) => void; onDelete: (listing: BusinessListingRow) => void }) {
  return (
    <Table aria-label="Listings">
      <thead>
        <tr>
          <Th>Directory</Th>
          <Th>Status</Th>
          {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((field) => (
            <Th key={field} className="text-center">
              {FIELD_LABELS[field]}
            </Th>
          ))}
          <Th>Last checked</Th>
          <Th>
            <span className="sr-only">Actions</span>
          </Th>
        </tr>
      </thead>
      <tbody>
        {checks.map(({ listing, fields }) => {
          const href = getSafeHttpUrl(listing.listing_url)
          return (
            <tr key={listing.id}>
              <Td className="font-medium text-ink">
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">
                    {listing.directory}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  listing.directory
                )}
                {listing.notes ? <p className="mt-0.5 max-w-xs text-xs font-normal break-words text-ink-3">{listing.notes}</p> : null}
              </Td>
              <Td>
                <StatusBadge tone={STATUS_TONE[listing.status]}>{LISTING_STATUS_LABELS[listing.status]}</StatusBadge>
              </Td>
              {(Object.keys(FIELD_LABELS) as (keyof typeof FIELD_LABELS)[]).map((field) => (
                <Td key={field} className="text-center">
                  <FieldMark check={fields[field]} label={FIELD_LABELS[field]} />
                </Td>
              ))}
              <Td className="whitespace-nowrap">{listing.last_checked ? formatDate(listing.last_checked, { timeZone: 'UTC' }) : '—'}</Td>
              <Td className="whitespace-nowrap text-right">
                <Button variant="ghost" size="sm" onClick={() => onEdit(listing)} aria-label={`Edit ${listing.directory}`}>
                  Edit
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onDelete(listing)} aria-label={`Delete ${listing.directory}`}>
                  Delete
                </Button>
              </Td>
            </tr>
          )
        })}
      </tbody>
    </Table>
  )
}

export function ListingsPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectsState = useProjectList()
  const projects = projectsState.projects
  const selected = projects?.find((project) => project.id === searchParams.get('project')) ?? null
  const projectId = selected?.id ?? null

  const listings = useLoad(projectId, () => listListings(projectId ?? ''))
  const gbp = useLoad(projectId, () => getGbpProfile(projectId ?? ''))

  const [formState, setFormState] = useState<{ editing: BusinessListingRow | null; directory: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<BusinessListingRow | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const reference = useMemo(
    () => (selected ? referenceNap(selected, gbp.value?.data ?? null) : null),
    [selected, gbp.value],
  )
  const rows = listings.value?.data ?? null
  const summary = useMemo(() => (reference && rows ? summarizeListings(rows, reference) : null), [reference, rows])

  async function confirmDelete() {
    if (!pendingDelete) return
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteListing(pendingDelete.id)
    setDeleting(false)
    if (result.data === null) {
      setDeleteError(result.error)
      return
    }
    setPendingDelete(null)
    listings.reload()
  }

  const header = (
    <PageHeader
      title="Business Listings"
      description="Keep track of where each business is listed online, and make sure every listing shows the same name, address, phone number and website."
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
  if (projectsState.error || !projects) {
    return (
      <>
        {header}
        <Alert variant="error" title="Could not load your projects">
          {projectsState.error}
        </Alert>
      </>
    )
  }
  if (projects.length === 0) {
    return (
      <>
        {header}
        <Card>
          <EmptyState icon="list" title="Create a project first" description="Listings are tracked per project." action={<ButtonLink to="/projects/new">New project</ButtonLink>} />
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
            id="listings-project"
            projects={projects}
            value={selected?.id ?? ''}
            onChange={(id) => {
              setFormState(null)
              const next = new URLSearchParams(searchParams)
              if (id) next.set('project', id)
              else next.delete('project')
              setSearchParams(next, { replace: true })
            }}
          />
          {selected ? (
            <Button onClick={() => setFormState({ editing: null, directory: '' })} disabled={formState !== null}>
              Add listing
            </Button>
          ) : null}
        </div>
      </Card>

      {!selected ? (
        <Card>
          <EmptyState icon="list" title="Choose a project" description="Pick a project above to see and track its listings." />
        </Card>
      ) : (listings.loading && !rows) || gbp.loading || !reference ? (
        <LoadingState label="Loading listings…" />
      ) : listings.value?.error ? (
        <Alert variant="error" title="Could not load listings">
          {listings.value.error}
        </Alert>
      ) : (
        <>
          <Card as="section" aria-labelledby="reference-nap" className="mb-6">
            <CardHeader
              id="reference-nap"
              title="Correct business details"
              description={
                reference.source === 'gbp'
                  ? 'Taken from the Google Business Profile details. Every listing is compared with these.'
                  : 'Taken from the project. Enter the Google Business Profile details to compare addresses and phone numbers too.'
              }
              action={
                <ButtonLink to={`/gbp-audit?project=${selected.id}`} variant="secondary">
                  Edit profile details
                </ButtonLink>
              }
            />
            <dl className="grid gap-x-6 gap-y-3 p-5 text-sm sm:grid-cols-2">
              {(['name', 'phone', 'address', 'website'] as const).map((field) => (
                <div key={field}>
                  <dt className="text-xs font-medium text-ink-2">{FIELD_LABELS[field]}</dt>
                  <dd className="mt-0.5 break-words text-ink">{reference[field] ?? <span className="text-ink-3">Not set</span>}</dd>
                </div>
              ))}
            </dl>
          </Card>

          {formState ? (
            <ListingForm
              key={formState.editing?.id ?? `new:${formState.directory}`}
              project={selected}
              reference={reference}
              editing={formState.editing}
              initialDirectory={formState.directory}
              onSaved={() => {
                setFormState(null)
                listings.reload()
              }}
              onCancel={() => setFormState(null)}
            />
          ) : null}

          {summary ? (
            <>
              <Card as="section" aria-labelledby="listings-summary" className="mb-6">
                <CardHeader id="listings-summary" title="Summary" />
                <dl className="grid grid-cols-2 gap-px bg-subtle sm:grid-cols-4">
                  {(
                    [
                      ['Live listings', summary.live],
                      ['Consistent', summary.consistent],
                      ['Need fixing', summary.inconsistent + summary.duplicates],
                      ['Essential missing', summary.missingCore.length],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label} className="bg-surface px-5 py-4">
                      <dt className="text-xs font-medium text-ink-2">{label}</dt>
                      <dd className="mt-1 text-2xl font-semibold text-ink tabular-nums">{value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>

              {summary.missingCore.length > 0 ? (
                <Alert variant="warning" className="mb-6" title="Essential listings not recorded yet">
                  <p>Every local business should be on these. Check whether a listing exists (claim it) or create one, then record it here.</p>
                  <ul className="mt-2 flex flex-wrap gap-2" aria-label="Missing essential directories">
                    {summary.missingCore.map((name) => (
                      <li key={name}>
                        <button
                          type="button"
                          onClick={() => setFormState({ editing: null, directory: name })}
                          className="rounded-full border border-warn/30 bg-surface px-3 py-1 text-xs font-medium text-warn hover:bg-warn-soft"
                        >
                          + {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </Alert>
              ) : null}

              <Card as="section" aria-labelledby="listings-table">
                <CardHeader
                  id="listings-table"
                  title="Listings"
                  description="✓ matches the correct details, ✗ differs, — not entered. Fix every ✗ on the directory itself."
                />
                {summary.checks.length === 0 ? (
                  <EmptyState icon="list" title="No listings recorded yet" description="Add the directories this business is listed on, starting with the essential ones above." />
                ) : (
                  <ListingsTable
                    checks={summary.checks}
                    onEdit={(listing) => setFormState({ editing: listing, directory: listing.directory })}
                    onDelete={(listing) => {
                      setDeleteError(null)
                      setPendingDelete(listing)
                    }}
                  />
                )}
              </Card>

              <details className="mt-6 rounded-xl border border-line bg-surface p-5 text-sm">
                <summary className="cursor-pointer font-medium text-ink">Suggested directories</summary>
                <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                  {DIRECTORIES.map((directory) => (
                    <li key={directory.name} className="flex items-center justify-between gap-2">
                      <a href={directory.addUrl} target="_blank" rel="noopener noreferrer" className="text-accent-ink hover:underline">
                        {directory.name}
                      </a>
                      <span className="text-xs text-ink-3">{TIER_LABELS[directory.tier]}</span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs text-ink-3">
                  Check with the{' '}
                  <Link to={`/gbp-audit?project=${selected.id}`} className="text-accent-ink hover:underline">
                    Business Profile audit
                  </Link>{' '}
                  that the profile itself is complete first.
                </p>
              </details>
            </>
          ) : null}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this listing?"
        confirmLabel="Delete listing"
        busy={deleting}
        error={deleteError}
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      >
        <p>
          The record for <strong className="font-semibold text-ink">{pendingDelete?.directory}</strong> will be removed from this
          app. The listing on the directory itself is not affected.
        </p>
      </ConfirmDialog>
    </>
  )
}
