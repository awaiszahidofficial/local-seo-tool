import { createClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
import { getEnv } from './env'

const env = getEnv()

/**
 * Browser Supabase client. Uses only the public publishable/anon key; all data access is
 * constrained by Row Level Security policies defined in supabase/migrations.
 */
export const supabase = createClient<Database>(env.supabaseUrl, env.supabasePublishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})
