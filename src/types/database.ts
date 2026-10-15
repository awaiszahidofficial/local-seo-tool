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
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
