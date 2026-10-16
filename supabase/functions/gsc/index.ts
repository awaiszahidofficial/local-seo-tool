// Supabase Edge Function: gsc (Google Search Console)
//
// POST { "action": ... } with the signed-in user's JWT. Actions:
//   status                                   -> { connected, email }
//   auth_url   { redirectUri, state }        -> { url }   (Google consent screen)
//   exchange   { code, redirectUri }         -> { connected: true, email }
//   disconnect                               -> { connected: false }
//   sites                                    -> { sites: [{ siteUrl, permissionLevel }] }
//   performance { projectId, days }          -> totals, queries and pages for two periods
//
// Secrets (set with `npx supabase secrets set`):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   OAuth "Web application" client from Google Cloud
//   GSC_REDIRECT_URIS                        comma-separated allow-list, e.g.
//                                            https://your-app.vercel.app/search-console/callback,http://localhost:5173/search-console/callback
//
// Google tokens are stored encrypted in public.gsc_connections, a table only the service role can
// read. They never reach the browser.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'
import {
  GOOGLE_REVOKE_URL,
  GOOGLE_TOKEN_URL,
  GSC_API,
  GSC_ROW_LIMIT,
  buildAuthUrl,
  decryptToken,
  emailFromIdToken,
  encryptToken,
  isAllowedRedirect,
  isGscPeriod,
  isValidSiteUrl,
  isValidState,
  normalizeRows,
  normalizeTotals,
  parseAllowedRedirects,
  periodRanges,
  type DateRange,
} from '../_shared/gsc.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GOOGLE_TIMEOUT_MS = 20_000

function sortByKey<T extends { key: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.key.localeCompare(b.key))
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } })
}

class UserError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly code?: string,
  ) {
    super(message)
  }
}

type Config = { clientId: string; clientSecret: string; redirects: string[] }

type Connection = {
  user_id: string
  google_email: string | null
  refresh_token: string
  access_token: string | null
  access_token_expires_at: string | null
}

async function google(url: string, init: RequestInit): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(GOOGLE_TIMEOUT_MS) })
  } catch {
    throw new UserError('Could not reach Google. Please try again.', 502)
  }
  const body: unknown = await response.json().catch(() => null)
  return { status: response.status, body }
}

function googleError(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const record = body as { error?: unknown; error_description?: unknown }
  if (typeof record.error === 'string') return record.error
  if (typeof record.error === 'object' && record.error !== null) {
    const message = (record.error as { message?: unknown }).message
    return typeof message === 'string' ? message.slice(0, 200) : ''
  }
  return ''
}

async function loadConnection(admin: SupabaseClient, userId: string): Promise<Connection | null> {
  const { data, error } = await admin
    .from('gsc_connections')
    .select('user_id, google_email, refresh_token, access_token, access_token_expires_at')
    .eq('user_id', userId)
    .maybeSingle()
  if (error) throw new UserError('Could not read the Google connection. Has the Search Console migration been run?', 500)
  return (data as Connection | null) ?? null
}

/** A valid access token for the user, refreshing (and re-storing) it when expired. */
async function accessToken(admin: SupabaseClient, config: Config, connection: Connection): Promise<string> {
  const expiresAt = connection.access_token_expires_at ? Date.parse(connection.access_token_expires_at) : 0
  if (connection.access_token && expiresAt - Date.now() > 60_000) {
    return decryptToken(connection.access_token, config.clientSecret)
  }
  const refreshToken = await decryptToken(connection.refresh_token, config.clientSecret)
  const { status, body } = await google(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  const token = (body as { access_token?: unknown; expires_in?: unknown } | null) ?? {}
  if (status !== 200 || typeof token.access_token !== 'string') {
    if (googleError(body) === 'invalid_grant') {
      // Revoked, expired (Testing-mode apps expire tokens after 7 days) or password changed.
      await admin.from('gsc_connections').delete().eq('user_id', connection.user_id)
      throw new UserError('Your Google connection has expired. Connect Google again.', 401, 'reconnect')
    }
    throw new UserError('Google refused to refresh the connection. Please try again.', 502)
  }
  const expiresIn = typeof token.expires_in === 'number' ? token.expires_in : 3600
  await admin
    .from('gsc_connections')
    .update({
      access_token: await encryptToken(token.access_token, config.clientSecret),
      access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
    })
    .eq('user_id', connection.user_id)
  return token.access_token
}

async function listSites(token: string): Promise<{ siteUrl: string; permissionLevel: string }[]> {
  const { status, body } = await google(`${GSC_API}/sites`, { headers: { Authorization: `Bearer ${token}` } })
  if (status === 401) throw new UserError('Your Google connection has expired. Connect Google again.', 401, 'reconnect')
  if (status === 403) {
    throw new UserError(
      'Google refused access to Search Console. Check that the Search Console API is enabled in your Google Cloud project.',
      403,
    )
  }
  if (status !== 200) throw new UserError('Could not load your Search Console properties.', 502)
  const entries = (body as { siteEntry?: unknown } | null)?.siteEntry
  if (!Array.isArray(entries)) return []
  return entries
    .map((entry) => entry as { siteUrl?: unknown; permissionLevel?: unknown })
    .filter((entry): entry is { siteUrl: string; permissionLevel: string } =>
      typeof entry.siteUrl === 'string' && typeof entry.permissionLevel === 'string',
    )
    .filter((entry) => entry.permissionLevel !== 'siteUnverifiedUser')
    .map((entry) => ({ siteUrl: entry.siteUrl, permissionLevel: entry.permissionLevel }))
    .sort((a, b) => a.siteUrl.localeCompare(b.siteUrl))
}

async function searchAnalytics(token: string, siteUrl: string, range: DateRange, dimension: 'query' | 'page' | 'date' | null) {
  const { status, body } = await google(`${GSC_API}/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      startDate: range.startDate,
      endDate: range.endDate,
      type: 'web',
      ...(dimension ? { dimensions: [dimension], rowLimit: GSC_ROW_LIMIT } : {}),
    }),
  })
  if (status === 401) throw new UserError('Your Google connection has expired. Connect Google again.', 401, 'reconnect')
  if (status === 403) {
    throw new UserError('This Google account no longer has access to that Search Console property. Choose another one.', 403)
  }
  if (status !== 200) throw new UserError(`Search Console returned an error${googleError(body) ? `: ${googleError(body)}` : ''}.`, 502)
  return body
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Please sign in.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')
  const redirects = parseAllowedRedirects(Deno.env.get('GSC_REDIRECT_URIS'))
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'The function is not configured.' }, 500)
  if (!clientId || !clientSecret || redirects.length === 0) {
    return json(
      {
        error:
          'Google is not set up yet. Add GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET and GSC_REDIRECT_URIS as Supabase secrets (see the README).',
        code: 'not_configured',
      },
      503,
    )
  }
  const config: Config = { clientId, clientSecret, redirects }

  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Your session has expired. Please sign in again.' }, 401)
  const userId = userData.user.id
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  let body: Record<string, unknown>
  try {
    const parsed: unknown = await req.json()
    if (typeof parsed !== 'object' || parsed === null) throw new Error('bad body')
    body = parsed as Record<string, unknown>
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }

  try {
    switch (body.action) {
      case 'status': {
        const connection = await loadConnection(admin, userId)
        return json({ connected: connection !== null, email: connection?.google_email ?? null })
      }

      case 'auth_url': {
        if (!isAllowedRedirect(body.redirectUri, config.redirects)) {
          throw new UserError('This app address is not in GSC_REDIRECT_URIS. Add it to the Supabase secret and to the Google OAuth client.')
        }
        if (!isValidState(body.state)) throw new UserError('Invalid request.')
        return json({ url: buildAuthUrl(config.clientId, body.redirectUri, body.state) })
      }

      case 'exchange': {
        if (!isAllowedRedirect(body.redirectUri, config.redirects)) throw new UserError('Invalid redirect address.')
        if (typeof body.code !== 'string' || body.code.length < 10 || body.code.length > 2048) throw new UserError('Invalid sign-in code.')
        const { status, body: token } = await google(GOOGLE_TOKEN_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            code: body.code,
            client_id: config.clientId,
            client_secret: config.clientSecret,
            redirect_uri: body.redirectUri,
            grant_type: 'authorization_code',
          }),
        })
        const record = (token as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; id_token?: unknown; scope?: unknown } | null) ?? {}
        if (status !== 200 || typeof record.access_token !== 'string') {
          throw new UserError(
            googleError(token) === 'redirect_uri_mismatch'
              ? 'Google rejected the redirect address. Add it to the OAuth client’s “Authorized redirect URIs”.'
              : 'Google did not accept the sign-in. Please try connecting again.',
          )
        }
        if (typeof record.scope === 'string' && !record.scope.includes('webmasters')) {
          throw new UserError('Search Console access was not granted. Connect again and tick the Search Console permission.')
        }
        if (typeof record.refresh_token !== 'string') {
          throw new UserError('Google did not return a long-term token. Remove the app at myaccount.google.com/permissions, then connect again.')
        }
        const email = emailFromIdToken(record.id_token)
        const expiresIn = typeof record.expires_in === 'number' ? record.expires_in : 3600
        const { error } = await admin.from('gsc_connections').upsert(
          {
            user_id: userId,
            google_email: email,
            refresh_token: await encryptToken(record.refresh_token, config.clientSecret),
            access_token: await encryptToken(record.access_token, config.clientSecret),
            access_token_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
          },
          { onConflict: 'user_id' },
        )
        if (error) throw new UserError('Could not save the Google connection. Has the Search Console migration been run?', 500)
        return json({ connected: true, email })
      }

      case 'disconnect': {
        const connection = await loadConnection(admin, userId)
        if (connection) {
          try {
            const refreshToken = await decryptToken(connection.refresh_token, config.clientSecret)
            await google(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: 'POST' })
          } catch {
            // Revoking is best effort; the stored tokens are deleted either way.
          }
          await admin.from('gsc_connections').delete().eq('user_id', userId)
        }
        return json({ connected: false })
      }

      case 'sites': {
        const connection = await loadConnection(admin, userId)
        if (!connection) throw new UserError('Connect Google first.', 401, 'reconnect')
        return json({ sites: await listSites(await accessToken(admin, config, connection)) })
      }

      case 'performance': {
        if (typeof body.projectId !== 'string' || !UUID.test(body.projectId)) throw new UserError('Invalid project.')
        if (!isGscPeriod(body.days)) throw new UserError('Invalid date range.')
        const { data: project, error: projectError } = await userClient
          .from('projects')
          .select('id, gsc_property')
          .eq('id', body.projectId)
          .maybeSingle()
        if (projectError) throw new UserError('Could not load the project. Has the Search Console migration been run?', 500)
        if (!project) throw new UserError('Project not found, or you do not have access to it.', 404)
        const property = (project as { gsc_property: unknown }).gsc_property
        if (!isValidSiteUrl(property)) throw new UserError('Choose a Search Console property for this project first.', 409, 'no_property')

        const connection = await loadConnection(admin, userId)
        if (!connection) throw new UserError('Connect Google first.', 401, 'reconnect')
        const token = await accessToken(admin, config, connection)
        const ranges = periodRanges(new Date(), body.days)

        const [totalsNow, totalsBefore, queriesNow, queriesBefore, pagesNow, pagesBefore, dailyNow, dailyBefore] = await Promise.all([
          searchAnalytics(token, property, ranges.current, null),
          searchAnalytics(token, property, ranges.previous, null),
          searchAnalytics(token, property, ranges.current, 'query'),
          searchAnalytics(token, property, ranges.previous, 'query'),
          searchAnalytics(token, property, ranges.current, 'page'),
          searchAnalytics(token, property, ranges.previous, 'page'),
          searchAnalytics(token, property, ranges.current, 'date'),
          searchAnalytics(token, property, ranges.previous, 'date'),
        ])
        return json({
          property,
          ranges,
          totals: { current: normalizeTotals(totalsNow), previous: normalizeTotals(totalsBefore) },
          queries: { current: normalizeRows(queriesNow), previous: normalizeRows(queriesBefore) },
          pages: { current: normalizeRows(pagesNow), previous: normalizeRows(pagesBefore) },
          daily: { current: sortByKey(normalizeRows(dailyNow)), previous: sortByKey(normalizeRows(dailyBefore)) },
        })
      }

      default:
        return json({ error: 'Unknown action.' }, 400)
    }
  } catch (error) {
    if (error instanceof UserError) return json({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status)
    return json({ error: 'Something went wrong talking to Google. Please try again.' }, 500)
  }
})
