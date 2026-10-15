// Supabase Edge Function: crawl-site
//
// POST { "projectId": "<uuid>" } with the signed-in user's JWT.
//  1. Verifies the caller and that the project belongs to them (via RLS, using the caller's JWT).
//  2. Crawls the project's website with the safety limits in _shared/crawler.ts.
//  3. Stores the results with the service role (users cannot write crawl tables directly).
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase
// into every Edge Function. They are never sent to the browser.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { crawlSite, isPublicIp, parseCrawlUrl, type CrawledPage } from '../_shared/crawler.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** A crawl row still "running" newer than this blocks a second crawl of the same project. */
const RUNNING_GUARD_MS = 3 * 60 * 1000
/** Crawls kept per project; older ones (and their pages) are deleted after each successful crawl. */
const CRAWLS_TO_KEEP = 5

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

/** Rejects hostnames whose DNS records point at private networks (defence against DNS tricks). */
async function hostResolvesPublicly(hostname: string): Promise<boolean> {
  try {
    const [v4, v6] = await Promise.all([
      Deno.resolveDns(hostname, 'A').catch(() => [] as string[]),
      Deno.resolveDns(hostname, 'AAAA').catch(() => [] as string[]),
    ])
    const addresses = [...v4, ...v6]
    return addresses.length === 0 ? true : addresses.every(isPublicIp)
  } catch {
    return true // resolution is re-done by fetch itself; failures surface there
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const authorization = req.headers.get('Authorization')
  if (!authorization?.startsWith('Bearer ')) return json({ error: 'Please sign in to run a crawl.' }, 401)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'The crawler is not configured.' }, 500)

  // Acts as the caller: RLS decides which projects they may see.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Your session has expired. Please sign in again.' }, 401)
  const userId = userData.user.id

  let projectId: unknown
  try {
    projectId = ((await req.json()) as { projectId?: unknown }).projectId
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return json({ error: 'Invalid project.' }, 400)

  const { data: project, error: projectError } = await userClient
    .from('projects')
    .select('id, website_url')
    .eq('id', projectId)
    .maybeSingle()
  if (projectError) return json({ error: 'Could not load the project.' }, 500)
  if (!project) return json({ error: 'Project not found, or you do not have access to it.' }, 404)

  const startUrl = parseCrawlUrl(project.website_url)
  if (!startUrl) {
    return json({ error: 'This project’s website address cannot be crawled. Use a public http(s) address.' }, 422)
  }

  // Writes use the service role, only after ownership was verified above.
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  const since = new Date(Date.now() - RUNNING_GUARD_MS).toISOString()
  const { data: running } = await admin
    .from('crawls')
    .select('id')
    .eq('project_id', project.id)
    .eq('status', 'running')
    .gte('started_at', since)
    .limit(1)
  if (running && running.length > 0) {
    return json({ error: 'A crawl is already running for this project. Please wait for it to finish.' }, 409)
  }

  const { data: crawl, error: insertError } = await admin
    .from('crawls')
    .insert({ project_id: project.id, user_id: userId, start_url: startUrl.href.slice(0, 2048), status: 'running' })
    .select('id')
    .single()
  if (insertError || !crawl) return json({ error: 'Could not start the crawl.' }, 500)

  try {
    const result = await crawlSite({
      startUrl,
      fetcher: (url, init) => fetch(url, init),
      hostCheck: hostResolvesPublicly,
    })

    if (result.pages.length > 0) {
      const rows = result.pages.map((page: CrawledPage) => ({
        ...page,
        crawl_id: crawl.id,
        project_id: project.id,
        user_id: userId,
      }))
      const { error: pagesError } = await admin.from('crawl_pages').insert(rows)
      if (pagesError) throw new Error('Could not save the crawl results.')
    }

    await admin
      .from('crawls')
      .update({
        status: 'completed',
        pages_crawled: result.pages.length,
        stopped_reason: result.stoppedReason,
        finished_at: new Date().toISOString(),
      })
      .eq('id', crawl.id)

    // Housekeeping: keep only the newest crawls for this project. Failure here must not fail the crawl.
    try {
      const { data: old } = await admin
        .from('crawls')
        .select('id')
        .eq('project_id', project.id)
        .order('created_at', { ascending: false })
        .range(CRAWLS_TO_KEEP, CRAWLS_TO_KEEP + 200)
      if (old && old.length > 0) {
        await admin.from('crawls').delete().in('id', old.map((row: { id: string }) => row.id))
      }
    } catch {
      // ignore
    }

    return json({ crawlId: crawl.id, status: 'completed', pagesCrawled: result.pages.length })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'The crawl failed.'
    await admin
      .from('crawls')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', crawl.id)
    return json({ error: 'The crawl failed. Please try again.', crawlId: crawl.id }, 500)
  }
})
