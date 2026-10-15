import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock } = vi.hoisted(() => ({ fromMock: vi.fn() }))

vi.mock('../lib/supabase', () => ({ supabase: { from: fromMock } }))

import { createProject, deleteProject, getProject, listProjects, updateProject } from '../lib/projects'
import type { ProjectRow } from '../types/database'
import type { ProjectInput } from '../types/project'

const PROJECT_ID = '22222222-2222-4222-8222-222222222222'
const USER_ID = '11111111-1111-4111-8111-111111111111'

const row: ProjectRow = {
  id: PROJECT_ID,
  user_id: USER_ID,
  name: 'Acme Plumbing',
  website_url: 'https://acme.com',
  business_name: null,
  location: null,
  business_type: null,
  notes: null,
  created_at: '2026-10-15T00:00:00Z',
  updated_at: '2026-10-15T00:00:00Z',
}

const input: ProjectInput = {
  name: 'Acme Plumbing',
  website_url: 'https://acme.com',
  business_name: null,
  location: 'Austin, TX',
  business_type: null,
  notes: null,
}

beforeEach(() => {
  fromMock.mockReset()
})

describe('listProjects', () => {
  it('orders by newest first and returns rows', async () => {
    const order = vi.fn().mockResolvedValue({ data: [row], error: null })
    const select = vi.fn(() => ({ order }))
    fromMock.mockReturnValue({ select })

    const result = await listProjects()

    expect(fromMock).toHaveBeenCalledWith('projects')
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false })
    expect(result).toEqual({ data: [row], error: null })
  })

  it('maps database errors to friendly messages', async () => {
    const order = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'raw rls detail' } })
    fromMock.mockReturnValue({ select: () => ({ order }) })

    const result = await listProjects()

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/permission/i)
    expect(result.error).not.toContain('raw rls detail')
  })

  it('converts thrown network errors into a message instead of rejecting', async () => {
    const order = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    fromMock.mockReturnValue({ select: () => ({ order }) })

    const result = await listProjects()

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/could not reach/i)
  })
})

describe('getProject', () => {
  it('returns not found without querying when the id is not a UUID', async () => {
    const result = await getProject('../../etc/passwd')
    expect(result).toEqual({ data: null, error: null })
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('returns the project when it is visible to the user', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const eq = vi.fn(() => ({ maybeSingle }))
    fromMock.mockReturnValue({ select: () => ({ eq }) })

    const result = await getProject(PROJECT_ID)

    expect(eq).toHaveBeenCalledWith('id', PROJECT_ID)
    expect(result).toEqual({ data: row, error: null })
  })

  it('returns data null with no error when RLS hides the row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ select: () => ({ eq: () => ({ maybeSingle }) }) })

    expect(await getProject(PROJECT_ID)).toEqual({ data: null, error: null })
  })
})

describe('createProject', () => {
  it('inserts the validated input with the signed-in user id as user_id', async () => {
    const single = vi.fn().mockResolvedValue({ data: row, error: null })
    const select = vi.fn(() => ({ single }))
    const insert = vi.fn(() => ({ select }))
    fromMock.mockReturnValue({ insert })

    const result = await createProject(USER_ID, input)

    expect(insert).toHaveBeenCalledWith({ user_id: USER_ID, ...input })
    expect(result).toEqual({ data: row, error: null })
  })

  it('returns a friendly error when the insert fails', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: { code: '23514', message: 'check violation' } })
    fromMock.mockReturnValue({ insert: () => ({ select: () => ({ single }) }) })

    const result = await createProject(USER_ID, input)

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/not allowed/i)
  })
})

describe('updateProject', () => {
  it('updates by id and returns the updated row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: { ...row, location: 'Austin, TX' }, error: null })
    const eq = vi.fn(() => ({ select: () => ({ maybeSingle }) }))
    const update = vi.fn(() => ({ eq }))
    fromMock.mockReturnValue({ update })

    const result = await updateProject(PROJECT_ID, input)

    expect(update).toHaveBeenCalledWith(input)
    expect(eq).toHaveBeenCalledWith('id', PROJECT_ID)
    expect(result.error).toBeNull()
    expect(result.data?.location).toBe('Austin, TX')
  })

  it('reports not found when no row was updated (missing or not owned)', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    fromMock.mockReturnValue({ update: () => ({ eq: () => ({ select: () => ({ maybeSingle }) }) }) })

    const result = await updateProject(PROJECT_ID, input)

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/not found/i)
  })

  it('rejects malformed ids without querying', async () => {
    const result = await updateProject('nope', input)
    expect(result.error).toMatch(/not found/i)
    expect(fromMock).not.toHaveBeenCalled()
  })
})

describe('deleteProject', () => {
  it('deletes by id and confirms a row was removed', async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: PROJECT_ID }], error: null })
    const eq = vi.fn(() => ({ select }))
    fromMock.mockReturnValue({ delete: () => ({ eq }) })

    const result = await deleteProject(PROJECT_ID)

    expect(eq).toHaveBeenCalledWith('id', PROJECT_ID)
    expect(result).toEqual({ data: { id: PROJECT_ID }, error: null })
  })

  it('reports not found when nothing was deleted (missing or not owned)', async () => {
    const select = vi.fn().mockResolvedValue({ data: [], error: null })
    fromMock.mockReturnValue({ delete: () => ({ eq: () => ({ select }) }) })

    const result = await deleteProject(PROJECT_ID)

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/not found/i)
  })

  it('surfaces database failures', async () => {
    const select = vi.fn().mockResolvedValue({ data: null, error: { code: '42501', message: 'denied' } })
    fromMock.mockReturnValue({ delete: () => ({ eq: () => ({ select }) }) })

    const result = await deleteProject(PROJECT_ID)

    expect(result.data).toBeNull()
    expect(result.error).toMatch(/permission/i)
  })
})
