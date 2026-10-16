// Supabase Edge Function: crawl-site
//
// POST { "projectId": "<uuid>" }                      starts a crawl
// POST { "projectId": "<uuid>", "crawlId": "<uuid>" }  continues (or resumes) that crawl
// with the signed-in user's JWT.
//  1. Verifies the caller and that the project belongs to them (via RLS, using the caller's JWT).
//  2. Crawls one slice (about a minute) with the safety limits in _shared/crawler.ts and limits.ts.
//  3. Stores the pages and the remaining queue with the service role (users cannot write crawl tables).
//  4. Responds { status: "running" } when more remains, so the browser calls again, or
//     { status: "completed" } once the crawl is finished (duplicate checks and clean-up done).
//
// SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are injected by Supabase
// into every Edge Function. They are never sent to the browser.

import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  applyDuplicateIssues,
  beginCrawl,
  crawlStep,
  isCrawlState,
  isPublicIp,
  parseCrawlUrl,
  type CrawledPage,
  type CrawlState,
  type StopReason,
} from '../_shared/crawler.ts'
import {
  CRAWL_MAX_PAGES,
  CRAWL_SLICE_BUDGET_MS,
  CRAWL_SLICE_MAX_PAGES,
  CRAWL_STALE_AFTER_MS,
  CRAWL_TOTAL_BUDGET_MS,
} from '../_shared/limits.ts'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
/** How long one slice may hold the crawl's lock (slice budget plus time to save). */
const LOCK_MS = CRAWL_SLICE_BUDGET_MS + 90_000
/** Rows per insert / ids per update, to keep each database request small. */
const WRITE_CHUNK = 100
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

// deno-lint-ignore no-explicit-any
type Admin = any

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
  return out
}

/** Keeps only the newest crawls for a project. Failure here must not fail the crawl. */
async function pruneOldCrawls(admin: Admin, projectId: string): Promise<void> {
  try {
    const { data: old } = await admin
      .from('crawls')
      .select('id')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .range(CRAWLS_TO_KEEP, CRAWLS_TO_KEEP + 200)
    if (old && old.length > 0) {
      await admin.from('crawls').delete().in('id', old.map((row: { id: string }) => row.id))
    }
  } catch {
    // ignore
  }
}

/**
 * Ends a crawl: adds duplicate title / meta description issues across ALL of its pages (slices
 * could not see each other's pages), marks it completed and removes its saved queue.
 */
async function finishCrawl(
  admin: Admin,
  crawlId: string,
  projectId: string,
  pagesCrawled: number,
  stoppedReason: StopReason,
): Promise<void> {
  type Row = {
    id: string
    title: string | null
    meta_description: string | null
    status_code: number | null
    error: string | null
    issues: string[]
  }
  const rows: Row[] = []
  for (let from = 0; from < CRAWL_MAX_PAGES + 1000; from += 1000) {
    const { data, error } = await admin
      .from('crawl_pages')
      .select('id, title, meta_description, status_code, error, issues')
      .eq('crawl_id', crawlId)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (error) throw new Error('Could not read the crawl results.')
    rows.push(...((data ?? []) as Row[]))
    if (!data || data.length < 1000) break
  }

  const updated = applyDuplicateIssues(rows)
  const groups = new Map<string, { issues: string[]; ids: string[] }>()
  updated.forEach((issues, index) => {
    const row = rows[index]
    if (!issues || !row) return
    const key = issues.join(',')
    const group = groups.get(key) ?? { issues, ids: [] }
    group.ids.push(row.id)
    groups.set(key, group)
  })
  for (const group of groups.values()) {
    for (const ids of chunk(group.ids, WRITE_CHUNK)) {
      const { error } = await admin.from('crawl_pages').update({ issues: group.issues }).in('id', ids)
      if (error) throw new Error('Could not save duplicate checks.')
    }
  }

  const finishedAt = new Date().toISOString()
  await admin
    .from('crawls')
    .update({
      status: 'completed',
      pages_crawled: Math.min(pagesCrawled, CRAWL_MAX_PAGES),
      stopped_reason: stoppedReason,
      finished_at: finishedAt,
      last_activity_at: finishedAt,
    })
    .eq('id', crawlId)
  await admin.from('crawl_state').delete().eq('crawl_id', crawlId)
  await pruneOldCrawls(admin, projectId)
}

type SliceContext = {
  admin: Admin
  crawlId: string
  projectId: string
  userId: string
  startUrl: URL
  state: CrawlState
  startedAtMs: number
  pagesSoFar: number
}

/** Crawls one slice, saves it, and either finishes the crawl or saves the queue for the next call. */
async function runSlice(ctx: SliceContext): Promise<Response> {
  const { admin, crawlId, projectId, userId } = ctx
  try {
    const totalDeadline = ctx.startedAtMs + CRAWL_TOTAL_BUDGET_MS
    const deadline = Math.min(Date.now() + CRAWL_SLICE_BUDGET_MS, totalDeadline)
    const step = await crawlStep({
      startUrl: ctx.startUrl,
      fetcher: (url, init) => fetch(url, init),
      hostCheck: hostResolvesPublicly,
      state: ctx.state,
      deadline,
      stepMaxPages: CRAWL_SLICE_MAX_PAGES,
      limits: { maxPages: CRAWL_MAX_PAGES },
    })

    // Never store more than the database allows, whatever the saved state says.
    const room = Math.max(0, CRAWL_MAX_PAGES - ctx.pagesSoFar)
    const pages = step.pages.slice(0, room)
    const rows = pages.map((page: CrawledPage) => ({ ...page, crawl_id: crawlId, project_id: projectId, user_id: userId }))
    for (const part of chunk(rows, WRITE_CHUNK)) {
      const { error: pagesError } = await admin.from('crawl_pages').insert(part)
      if (pagesError) throw new Error('Could not save the crawl results.')
    }
    const total = ctx.pagesSoFar + pages.length

    let finished: StopReason | null = null
    if (step.outcome === 'completed') finished = 'completed'
    else if (step.outcome === 'page_limit' || total >= CRAWL_MAX_PAGES) finished = 'page_limit'
    else if (Date.now() >= totalDeadline) finished = 'time_limit'

    if (finished) {
      await finishCrawl(admin, crawlId, projectId, total, finished)
      return json({ crawlId, status: 'completed', pagesCrawled: Math.min(total, CRAWL_MAX_PAGES) })
    }

    const now = new Date().toISOString()
    const { error: stateError } = await admin
      .from('crawl_state')
      .update({ state: step.state, locked_until: null, updated_at: now })
      .eq('crawl_id', crawlId)
    if (stateError) throw new Error('Could not save the crawl progress.')
    await admin.from('crawls').update({ pages_crawled: total, last_activity_at: now }).eq('id', crawlId)
    return json({ crawlId, status: 'running', pagesCrawled: total })
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : 'The crawl failed.'
    await admin
      .from('crawls')
      .update({ status: 'failed', error_message: message, finished_at: new Date().toISOString() })
      .eq('id', crawlId)
    await admin.from('crawl_state').delete().eq('crawl_id', crawlId)
    return json({ error: 'The crawl failed. Please try again.', crawlId }, 500)
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

  // Acts as the caller: RLS decides which projects and crawls they may see.
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } } })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) return json({ error: 'Your session has expired. Please sign in again.' }, 401)
  const userId = userData.user.id

  let projectId: unknown
  let crawlId: unknown
  try {
    const body = (await req.json()) as { projectId?: unknown; crawlId?: unknown }
    projectId = body.projectId
    crawlId = body.crawlId
  } catch {
    return json({ error: 'Invalid request.' }, 400)
  }
  if (typeof projectId !== 'string' || !UUID.test(projectId)) return json({ error: 'Invalid project.' }, 400)
  if (crawlId !== undefined && (typeof crawlId !== 'string' || !UUID.test(crawlId))) {
    return json({ error: 'Invalid crawl.' }, 400)
  }

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
  const admin: Admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // ---- Continue an existing crawl ------------------------------------------------------------
  if (typeof crawlId === 'string') {
    const { data: crawl, error: crawlError } = await userClient
      .from('crawls')
      .select('id, status, start_url, started_at, pages_crawled')
      .eq('id', crawlId)
      .eq('project_id', project.id)
      .maybeSingle()
    if (crawlError) return json({ error: 'Could not load the crawl.' }, 500)
    if (!crawl) return json({ error: 'Crawl not found, or you do not have access to it.' }, 404)
    if (crawl.status === 'completed') {
      return json({ crawlId: crawl.id, status: 'completed', pagesCrawled: crawl.pages_crawled })
    }
    if (crawl.status === 'failed') return json({ error: 'This crawl stopped with an error. Start a new crawl.' }, 409)

    const crawlStart = parseCrawlUrl(crawl.start_url) ?? startUrl
    const nowIso = new Date().toISOString()
    const { data: claimed, error: claimError } = await admin
      .from('crawl_state')
      .update({ locked_until: new Date(Date.now() + LOCK_MS).toISOString() })
      .eq('crawl_id', crawl.id)
      .or(`locked_until.is.null,locked_until.lt."${nowIso}"`)
      .select('state')
    if (claimError) return json({ error: 'Could not continue the crawl.' }, 500)

    if (!claimed || claimed.length === 0) {
      const { data: exists } = await admin.from('crawl_state').select('crawl_id').eq('crawl_id', crawl.id).maybeSingle()
      if (exists) {
        return json({ error: 'This crawl is already being continued, maybe in another tab. Please wait.' }, 409)
      }
      // Queue lost (should not happen): keep what was found and close the crawl.
      try {
        await finishCrawl(admin, crawl.id, project.id, crawl.pages_crawled, 'time_limit')
      } catch {
        return json({ error: 'Could not finish the crawl.' }, 500)
      }
      return json({ crawlId: crawl.id, status: 'completed', pagesCrawled: crawl.pages_crawled })
    }

    const saved: unknown = claimed[0]?.state
    if (!isCrawlState(saved)) {
      await finishCrawl(admin, crawl.id, project.id, crawl.pages_crawled, 'time_limit').catch(() => undefined)
      return json({ crawlId: crawl.id, status: 'completed', pagesCrawled: crawl.pages_crawled })
    }

    return runSlice({
      admin,
      crawlId: crawl.id,
      projectId: project.id,
      userId,
      startUrl: crawlStart,
      state: saved,
      startedAtMs: Date.parse(crawl.started_at) || Date.now(),
      pagesSoFar: crawl.pages_crawled,
    })
  }

  // ---- Start a new crawl -----------------------------------------------------------------------
  const { data: running } = await admin
    .from('crawls')
    .select('id, last_activity_at')
    .eq('project_id', project.id)
    .eq('status', 'running')
  const staleBefore = Date.now() - CRAWL_STALE_AFTER_MS
  const runningRows = (running ?? []) as { id: string; last_activity_at: string }[]
  if (runningRows.some((row) => Date.parse(row.last_activity_at) >= staleBefore)) {
    return json({ error: 'A crawl is already running for this project. Please wait for it to finish.' }, 409)
  }
  if (runningRows.length > 0) {
    // Abandoned crawls (page closed part-way) are replaced by this new one.
    const ids = runningRows.map((row) => row.id)
    await admin
      .from('crawls')
      .update({
        status: 'failed',
        error_message: 'Replaced by a newer crawl before it finished.',
        finished_at: new Date().toISOString(),
      })
      .in('id', ids)
    await admin.from('crawl_state').delete().in('crawl_id', ids)
  }

  const { data: crawl, error: insertError } = await admin
    .from('crawls')
    .insert({ project_id: project.id, user_id: userId, start_url: startUrl.href.slice(0, 2048), status: 'running' })
    .select('id, started_at')
    .single()
  if (insertError || !crawl) return json({ error: 'Could not start the crawl.' }, 500)

  let state: CrawlState | null
  try {
    state = await beginCrawl({ startUrl, fetcher: (url, init) => fetch(url, init), hostCheck: hostResolvesPublicly })
  } catch {
    state = null
  }
  if (!state) {
    try {
      await finishCrawl(admin, crawl.id, project.id, 0, 'blocked_by_robots')
    } catch {
      // the crawl row stays; nothing was fetched
    }
    return json({ crawlId: crawl.id, status: 'completed', pagesCrawled: 0 })
  }

  const { error: stateError } = await admin
    .from('crawl_state')
    .insert({ crawl_id: crawl.id, state, locked_until: new Date(Date.now() + LOCK_MS).toISOString() })
  if (stateError) {
    await admin
      .from('crawls')
      .update({
        status: 'failed',
        error_message: 'Could not save crawl progress. Has the 20261018000000_large_crawls.sql migration been run?',
        finished_at: new Date().toISOString(),
      })
      .eq('id', crawl.id)
    return json(
      {
        error:
          'Could not start the crawl. Run the 20261018000000_large_crawls.sql migration in Supabase, then try again.',
        crawlId: crawl.id,
      },
      500,
    )
  }

  return runSlice({
    admin,
    crawlId: crawl.id,
    projectId: project.id,
    userId,
    startUrl,
    state,
    startedAtMs: Date.parse(crawl.started_at) || Date.now(),
    pagesSoFar: 0,
  })
})
