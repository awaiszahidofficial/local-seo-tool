/**
 * Manually maintained types mirroring supabase/migrations.
 * Keep in sync with the SQL schema (or replace with `supabase gen types typescript`).
 */

export type ProfileRow = {
  id: string
  email: string | null
  created_at: string
  updated_at: string
}

export type ProjectRow = {
  id: string
  user_id: string
  name: string
  website_url: string
  business_name: string | null
  location: string | null
  business_type: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export type ProjectInsert = {
  id?: string
  user_id?: string
  name: string
  website_url: string
  business_name?: string | null
  location?: string | null
  business_type?: string | null
  notes?: string | null
  created_at?: string
  updated_at?: string
}

export type ProjectUpdate = Partial<ProjectInsert>

export type CrawlStatus = 'running' | 'completed' | 'failed'
export type CrawlStopReason = 'completed' | 'page_limit' | 'time_limit' | 'blocked_by_robots'

export type CrawlRow = {
  id: string
  project_id: string
  user_id: string
  status: CrawlStatus
  start_url: string
  pages_crawled: number
  stopped_reason: CrawlStopReason | null
  error_message: string | null
  started_at: string
  finished_at: string | null
  created_at: string
}

export type CrawlPageRow = {
  id: string
  crawl_id: string
  project_id: string
  user_id: string
  url: string
  final_url: string | null
  status_code: number | null
  title: string | null
  meta_description: string | null
  h1: string | null
  h1_count: number
  word_count: number
  canonical_url: string | null
  robots_meta: string | null
  internal_links_count: number
  response_time_ms: number | null
  depth: number
  issues: string[]
  error: string | null
  created_at: string
}

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: ProfileRow
        Insert: {
          id: string
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Update: {
          id?: string
          email?: string | null
          created_at?: string
          updated_at?: string
        }
        Relationships: []
      }
      projects: {
        Row: ProjectRow
        Insert: ProjectInsert
        Update: ProjectUpdate
        Relationships: []
      }
      // Crawl tables are written only by the crawl-site Edge Function (service role), so the
      // browser client is typed read/delete-only.
      crawls: {
        Row: CrawlRow
        Insert: never
        Update: never
        Relationships: []
      }
      crawl_pages: {
        Row: CrawlPageRow
        Insert: never
        Update: never
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
