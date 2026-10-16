import type { ProjectRow } from '../types/database'
import type { ProjectInput } from '../types/project'
import { getDatabaseErrorMessage } from './errors'
import { supabase } from './supabase'

/** `error === null` means success; `data` may still be null for "not found" lookups. */
export type DataResult<T> = { data: T; error: null } | { data: null; error: string }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

const NOT_FOUND_MESSAGE = 'Project not found, or you do not have access to it.'

async function guard<T>(operation: () => Promise<DataResult<T>>): Promise<DataResult<T>> {
  try {
    return await operation()
  } catch (error) {
    return { data: null, error: getDatabaseErrorMessage(error) }
  }
}

/**
 * All queries below go through the authenticated Supabase client. Ownership is enforced by
 * Row Level Security in the database, not by these functions.
 */
export function listProjects(): Promise<DataResult<ProjectRow[]>> {
  return guard(async () => {
    const { data, error } = await supabase
      .from('projects')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    return { data: data ?? [], error: null }
  })
}

/** Resolves with `data: null, error: null` when the project does not exist or is not visible to the user. */
export function getProject(id: string): Promise<DataResult<ProjectRow | null>> {
  if (!isUuid(id)) return Promise.resolve({ data: null, error: null })
  return guard(async () => {
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).maybeSingle()
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    return { data, error: null }
  })
}

export function createProject(userId: string, input: ProjectInput): Promise<DataResult<ProjectRow>> {
  return guard(async () => {
    const { data, error } = await supabase
      .from('projects')
      .insert({ user_id: userId, ...input })
      .select()
      .single()
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    return { data, error: null }
  })
}

export function updateProject(id: string, input: ProjectInput): Promise<DataResult<ProjectRow>> {
  if (!isUuid(id)) return Promise.resolve({ data: null, error: NOT_FOUND_MESSAGE })
  return guard(async () => {
    const { data, error } = await supabase
      .from('projects')
      .update(input)
      .eq('id', id)
      .select()
      .maybeSingle()
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    // RLS hides rows the user does not own, so an update that matched nothing looks like "not found".
    if (!data) return { data: null, error: NOT_FOUND_MESSAGE }
    return { data, error: null }
  })
}

export function deleteProject(id: string): Promise<DataResult<{ id: string }>> {
  if (!isUuid(id)) return Promise.resolve({ data: null, error: NOT_FOUND_MESSAGE })
  return guard(async () => {
    const { data, error } = await supabase.from('projects').delete().eq('id', id).select('id')
    if (error) return { data: null, error: getDatabaseErrorMessage(error) }
    if (!data || data.length === 0) return { data: null, error: NOT_FOUND_MESSAGE }
    return { data: { id }, error: null }
  })
}

const MISSING_COVERAGE_COLUMNS =
  'Service areas cannot be saved yet. Run the 20261019000000_service_areas.sql migration in Supabase, then try again.'

/** Saves a project's service areas and services (Service-Area Coverage). Lists are stored as given. */
export function updateCoverageLists(
  id: string,
  lists: { service_areas: string[]; services: string[] },
): Promise<DataResult<ProjectRow>> {
  if (!isUuid(id)) return Promise.resolve({ data: null, error: NOT_FOUND_MESSAGE })
  return guard(async () => {
    const { data, error } = await supabase
      .from('projects')
      .update({ service_areas: lists.service_areas, services: lists.services })
      .eq('id', id)
      .select()
      .maybeSingle()
    if (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
      const message = typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : ''
      if (code === '42703' || code === 'PGRST204' || /service_areas|services/.test(message)) {
        return { data: null, error: MISSING_COVERAGE_COLUMNS }
      }
      return { data: null, error: getDatabaseErrorMessage(error) }
    }
    if (!data) return { data: null, error: NOT_FOUND_MESSAGE }
    return { data, error: null }
  })
}
