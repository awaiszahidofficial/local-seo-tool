import type { RecommendationStateRow } from '../types/database'
import { getDatabaseErrorMessage } from './errors'
import { isUuid, type DataResult } from './projects'
import { supabase } from './supabase'

const MISSING_TABLE =
  'Progress cannot be saved yet. Run the 20261022000000_listings_recommendations_reports.sql migration in Supabase, then try again.'

function mapError(error: unknown): string {
  const record = typeof error === 'object' && error !== null ? (error as { code?: unknown; message?: unknown }) : {}
  if (record.code === '42P01' || record.code === 'PGRST205' || String(record.message ?? '').includes('recommendation_states')) return MISSING_TABLE
  return getDatabaseErrorMessage(error)
}

export async function listRecommendationStates(projectId: string): Promise<DataResult<RecommendationStateRow[]>> {
  if (!isUuid(projectId)) return { data: [], error: null }
  try {
    const { data, error } = await supabase.from('recommendation_states').select('*').eq('project_id', projectId).limit(2000)
    if (error) return { data: null, error: mapError(error) }
    return { data: data ?? [], error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}

/** Marks a recommendation done or dismissed; `null` reopens it. */
export async function setRecommendationState(
  projectId: string,
  key: string,
  status: 'done' | 'dismissed' | null,
): Promise<DataResult<{ key: string }>> {
  if (!isUuid(projectId) || key.length === 0 || key.length > 300) return { data: null, error: 'Invalid recommendation.' }
  try {
    const { error } =
      status === null
        ? await supabase.from('recommendation_states').delete().eq('project_id', projectId).eq('rec_key', key)
        : await supabase
            .from('recommendation_states')
            .upsert({ project_id: projectId, rec_key: key, status }, { onConflict: 'project_id,rec_key' })
    if (error) return { data: null, error: mapError(error) }
    return { data: { key }, error: null }
  } catch (error) {
    return { data: null, error: mapError(error) }
  }
}
