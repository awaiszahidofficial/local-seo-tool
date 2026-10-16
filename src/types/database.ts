import type { SchemaLocal } from '../../supabase/functions/_shared/crawler.ts'

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
  /** Added by migration 20261019000000 (Service-Area Coverage); priority order. */
  service_areas?: string[]
  services?: string[]
  /** Added by migration 20261021000000 (Search Console property for this project). */
  gsc_property?: string | null
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

export type ProjectUpdate = Partial<ProjectInsert> & { service_areas?: string[]; services?: string[]; gsc_property?: string | null }

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
  /** Added by migration 20261018000000; updated after every crawl slice. */
  last_activity_at?: string
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
  // Local signals (migration 20261017000000). local_version 0 = crawled before they existed.
  h2s: string[]
  body_text: string | null
  phones: string[]
  tel_links: number
  schema_types: string[]
  schema_local: SchemaLocal | null
  has_map_embed: boolean
  address_text: string | null
  link_paths: string[]
  local_version: number
}

/** Google Business Profile details entered for a project (migration 20261020000000). */
export type GbpProfileRow = {
  project_id: string
  user_id: string
  verified: boolean | null
  business_name: string | null
  primary_category: string | null
  additional_categories: string[]
  phone: string | null
  website_url: string | null
  address: string | null
  service_area_business: boolean
  gbp_service_areas: string[]
  has_hours: boolean | null
  has_special_hours: boolean | null
  description: string | null
  services: string[]
  products_count: number | null
  photos_count: number | null
  has_logo: boolean | null
  has_cover_photo: boolean | null
  review_count: number | null
  rating: number | null
  reviews_last_90_days: number | null
  reply_rate: number | null
  last_post_date: string | null
  attributes_count: number | null
  has_booking_link: boolean | null
  created_at: string
  updated_at: string
}

/** Everything the user can write (ids and timestamps are set by the database). */
export type GbpProfileInput = Omit<GbpProfileRow, 'user_id' | 'created_at' | 'updated_at'>

export type ListingStatus = 'live' | 'needs_update' | 'pending' | 'not_listed' | 'duplicate'

/** A directory / citation listing tracked for a project (migration 20261022000000). */
export type BusinessListingRow = {
  id: string
  project_id: string
  user_id: string
  directory: string
  listing_url: string | null
  status: ListingStatus
  name: string | null
  address: string | null
  phone: string | null
  website: string | null
  notes: string | null
  last_checked: string | null
  created_at: string
  updated_at: string
}

export type BusinessListingInput = Omit<BusinessListingRow, 'id' | 'project_id' | 'user_id' | 'created_at' | 'updated_at'>

export type RecommendationStateRow = {
  project_id: string
  rec_key: string
  user_id: string
  status: 'done' | 'dismissed'
  updated_at: string
}

export type ReportRow = {
  id: string
  project_id: string
  user_id: string
  title: string
  /** A ReportSnapshot (src/lib/reportSnapshot.ts) stored as JSON. */
  snapshot: unknown
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
      business_listings: {
        Row: BusinessListingRow
        Insert: BusinessListingInput & { project_id: string; user_id?: string }
        Update: Partial<BusinessListingInput>
        Relationships: []
      }
      recommendation_states: {
        Row: RecommendationStateRow
        Insert: { project_id: string; rec_key: string; status: 'done' | 'dismissed'; user_id?: string }
        Update: { status?: 'done' | 'dismissed' }
        Relationships: []
      }
      reports: {
        Row: ReportRow
        Insert: { project_id: string; title: string; snapshot: unknown; user_id?: string }
        Update: never
        Relationships: []
      }
      gbp_profiles: {
        Row: GbpProfileRow
        Insert: GbpProfileInput & { user_id?: string }
        Update: Partial<GbpProfileInput>
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
