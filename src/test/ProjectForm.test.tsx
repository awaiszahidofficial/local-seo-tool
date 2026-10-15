import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ProjectForm } from '../components/ProjectForm'
import { PROJECT_LIMITS } from '../lib/validation'
import type { ProjectFormValues, ProjectInput } from '../types/project'

function setup(onSubmit: (data: ProjectInput) => Promise<string | null> = () => Promise.resolve(null), initialValues?: ProjectFormValues) {
  const submit = vi.fn(onSubmit)
  render(
    <MemoryRouter>
      <ProjectForm submitLabel="Create project" onSubmit={submit} cancelTo="/projects" initialValues={initialValues} />
    </MemoryRouter>,
  )
  return { submit, user: userEvent.setup() }
}

describe('ProjectForm', () => {
  it('renders a labelled control for every field', () => {
    setup()
    expect(screen.getByLabelText(/project name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/website url/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/business name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/primary location/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/business type/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Cancel' })).toHaveAttribute('href', '/projects')
  })

  it('shows inline errors for missing required fields and does not submit', async () => {
    const { submit, user } = setup()
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText('Project name is required.')).toBeInTheDocument()
    expect(screen.getByText('Website URL is required.')).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()

    const nameInput = screen.getByLabelText(/project name/i)
    expect(nameInput).toHaveAttribute('aria-invalid', 'true')
    expect(nameInput).toHaveAccessibleDescription('Project name is required.')
    expect(nameInput).toHaveFocus()
  })

  it('shows an error for an unsupported URL protocol', async () => {
    const { submit, user } = setup()
    await user.type(screen.getByLabelText(/project name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/website url/i), 'javascript:alert(1)')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByText('Only http:// and https:// website URLs are supported.')).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })

  it('shows a length error for an over-long name', async () => {
    const { submit, user } = setup()
    fireEvent.change(screen.getByLabelText(/project name/i), { target: { value: 'a'.repeat(PROJECT_LIMITS.nameMax + 1) } })
    await user.type(screen.getByLabelText(/website url/i), 'example.com')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(
      await screen.findByText(`Project name must be ${PROJECT_LIMITS.nameMax} characters or fewer.`),
    ).toBeInTheDocument()
    expect(submit).not.toHaveBeenCalled()
  })

  it('clears a field error when the user edits that field', async () => {
    const { user } = setup()
    await user.click(screen.getByRole('button', { name: 'Create project' }))
    expect(await screen.findByText('Project name is required.')).toBeInTheDocument()

    await user.type(screen.getByLabelText(/project name/i), 'A')
    expect(screen.queryByText('Project name is required.')).not.toBeInTheDocument()
  })

  it('previews the normalized URL when the protocol is omitted', async () => {
    const { user } = setup()
    await user.type(screen.getByLabelText(/website url/i), 'www.acme.com/services')
    expect(screen.getByText('Will be saved as https://www.acme.com/services')).toBeInTheDocument()
  })

  it('submits trimmed, normalized data with empty optionals as null', async () => {
    const { submit, user } = setup()
    await user.type(screen.getByLabelText(/project name/i), '  Acme Plumbing  ')
    await user.type(screen.getByLabelText(/website url/i), '  acme.com  ')
    await user.type(screen.getByLabelText(/primary location/i), ' Austin, TX ')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(submit).toHaveBeenCalledTimes(1))
    expect(submit).toHaveBeenCalledWith({
      name: 'Acme Plumbing',
      website_url: 'https://acme.com',
      business_name: null,
      location: 'Austin, TX',
      business_type: null,
      notes: null,
    })
  })

  it('prevents duplicate submissions while saving', async () => {
    let resolveSubmit: (value: string | null) => void = () => {}
    const { submit, user } = setup(
      () =>
        new Promise<string | null>((resolve) => {
          resolveSubmit = resolve
        }),
    )
    await user.type(screen.getByLabelText(/project name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/website url/i), 'acme.com')

    const form = screen.getByRole('form', { name: 'Project form' })
    fireEvent.submit(form)
    fireEvent.submit(form)
    fireEvent.submit(form)

    expect(submit).toHaveBeenCalledTimes(1)
    const button = await screen.findByRole('button', { name: 'Create project' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    resolveSubmit(null)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled())
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('displays the error returned by the save operation and re-enables the form', async () => {
    const { submit, user } = setup(() => Promise.resolve('You do not have permission to perform that action.'))
    await user.type(screen.getByLabelText(/project name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/website url/i), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to perform that action.')
    expect(submit).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Create project' })).toBeEnabled()
    expect(screen.getByLabelText(/project name/i)).toHaveValue('Acme Plumbing')
  })

  it('shows a generic error if the save operation throws', async () => {
    const { user } = setup(() => Promise.reject(new Error('boom')))
    await user.type(screen.getByLabelText(/project name/i), 'Acme Plumbing')
    await user.type(screen.getByLabelText(/website url/i), 'acme.com')
    await user.click(screen.getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Something went wrong while saving')
  })

  it('populates initial values when editing', () => {
    setup(undefined, {
      name: 'Existing',
      website_url: 'https://existing.com',
      business_name: 'Existing LLC',
      location: 'Denver',
      business_type: 'Dentist',
      notes: 'Some notes',
    })
    expect(screen.getByLabelText(/project name/i)).toHaveValue('Existing')
    expect(screen.getByLabelText(/website url/i)).toHaveValue('https://existing.com')
    expect(screen.getByLabelText(/business name/i)).toHaveValue('Existing LLC')
    expect(screen.getByLabelText(/primary location/i)).toHaveValue('Denver')
    expect(screen.getByLabelText(/business type/i)).toHaveValue('Dentist')
    expect(screen.getByLabelText(/notes/i)).toHaveValue('Some notes')
  })
})
