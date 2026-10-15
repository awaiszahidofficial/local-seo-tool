# Local SEO Workbench

Local SEO Workbench is a SaaS workspace for SEO specialists, agencies and local business owners who manage local SEO work across several client websites. The long-term goal is to audit sites, analyse Google Business Profiles, find local ranking opportunities, monitor Search Console data, track listings and generate reports.

**This repository contains Phase 1 (application foundation) and Phase 2 (Website Crawler).** Auth, project management and the crawler are real and working; the other SEO analysis modules are still planned.

## What Phase 1 implements

- Email/password **sign-up, sign-in, sign-out**, password-reset request and reset (recovery) flow, persistent sessions (Supabase Auth)
- Auth context, loading states, protected routes, and public-only routes that redirect signed-in users
- **Project management** (create, list, view, edit, delete with confirmation) backed by Supabase, with inline validation and URL normalisation (http/https only)
- Overview dashboard showing real project data, or an honest empty state for new accounts (no fake metrics)
- Responsive SaaS layout: persistent desktop sidebar, mobile/tablet drawer navigation, accessible forms and feedback
- Placeholder pages for the not-yet-built modules, clearly marked "not implemented in this phase"
- SQL migration with `profiles` and `projects` tables, constraints, indexes, `updated_at` triggers, a hardened signup trigger and Row Level Security
- Validation utilities (project form, URL, email, password, dates, URL display, env vars) with unit and component tests
- Vercel SPA rewrites and a GitHub Actions CI workflow

## What Phase 2 adds: Website Crawler

Pick a project, click **Start crawl**, and the app fetches up to 25 pages of that site (same site only, following internal links, honouring `robots.txt`) and shows, per page: HTTP status, title, H1, word count and a list of on-page issues, plus a summary and issue breakdown. Checks: failed or 4xx/5xx pages, missing/short/long/duplicate titles, missing/short/long/duplicate meta descriptions, missing or multiple H1, thin content (under 300 words), `noindex`, missing canonical, slow responses (over 3 s).

It works by calling a Supabase **Edge Function** (`supabase/functions/crawl-site`) because browsers cannot fetch other websites. The function verifies the signed-in user and that the project is theirs, crawls, and saves results with the service role (the key never leaves Supabase). Users can read and delete their own crawl data but cannot write it, so results cannot be forged from the browser.

Safety limits: public http(s) addresses only (localhost, private networks and IPv6 literals are refused, redirects are re-checked, DNS answers are checked), 25 pages, 1 MB per page, 8 s per request, 90 s total, one running crawl per project.

### Set up Phase 2 (two extra steps)

1. **Apply the second migration.** In Supabase SQL Editor, paste and run `supabase/migrations/20261016000000_crawls.sql` (after the first migration).
2. **Deploy the Edge Function** (needs the Supabase CLI, run via `npx`, no install). In the project folder:

   ```bash
   npx supabase login
   npx supabase link --project-ref <your-project-ref>
   npx supabase functions deploy crawl-site
   ```

   The project ref is the ID in Project Settings → General (the part before `.supabase.co`). `SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to the function automatically; you do not set them. No change is needed in Vercel, and redeploying the website is not required for the function.

3. Open **Website Crawler**, choose a project and start a crawl.

If you see "The crawler service is not available yet", the function is not deployed to this Supabase project. If you see "Could not load crawl results", the second migration has not been applied.

### Crawler limitations

- HTML is read as the server sends it. JavaScript-rendered pages (some page builders) may look thin or empty.
- HTML parsing is lightweight (no browser DOM), so unusual markup can be missed.
- Not checked yet: broken external links, images, structured data, sitemaps, mobile or speed scores.
- A DNS-rebinding attacker could in theory change a hostname's address between the safety check and the fetch; the function also validates every redirect and re-checks DNS per request.
- The crawl runs while the page is open (up to about 90 s); it is not a background job yet.

## Still planned (not implemented)

Local Page Auditor, Service-Area Coverage, Google Business Profile Audit, Google Search Console, Business Listings, Keyword Opportunities, Recommendations and Reports. These appear in the sidebar labelled as planned and do nothing yet. No crawling, Google integration, AI or reporting exists in this phase.

## Prerequisites

- Node.js **22.13+** (see `.nvmrc`; `engines` enforces it) and npm 10+
- A free [Supabase](https://supabase.com) project
- Optional: a GitHub account and a Vercel account for deployment

## Install

```bash
npm install
```

## Configure Supabase

1. Create a project at supabase.com.
2. **Apply the migration** (pick one):
   - *Dashboard:* open **SQL Editor**, paste the contents of `supabase/migrations/20261015000000_init_profiles_and_projects.sql`, and run it once. (Phase 2 adds a second migration; see below.)
   - *CLI:* `npx supabase login`, `npx supabase link --project-ref <ref>`, then `npx supabase db push`.
3. **Auth settings** (Authentication → URL Configuration): set *Site URL* to `http://localhost:5173` for local work, and add these to *Redirect URLs*:
   - `http://localhost:5173/reset-password`
   - `https://<your-vercel-domain>/reset-password` (after deploying)
4. Under Authentication → Providers → Email, decide whether "Confirm email" is on. If on, new users must click the email link before signing in.
5. Copy the **Project URL** and **publishable key** from Project Settings → API.

## Environment variables

```bash
cp .env.example .env.local
```

```
VITE_SUPABASE_URL=https://<ref>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

If your project still uses the legacy key, put the **anon** key in `VITE_SUPABASE_PUBLISHABLE_KEY`. Every `VITE_*` variable is bundled into the browser, so never use the `service_role` / `sb_secret_...` key or a database password. The app refuses to start if a service-role key is detected, and shows a clear error screen if the variables are missing.

## Run locally

```bash
npm run dev        # http://localhost:5173
```

## Quality checks

```bash
npm run typecheck
npm run lint
npm test
npm run build      # runs tsc --noEmit, then vite build
npm run preview    # serve the production build locally
```

## Push to GitHub

```bash
git init -b main            # skip if already a repo
git add .
git commit -m "Phase 1 foundation"
git remote add origin https://github.com/<you>/local-seo-workbench.git
git push -u origin main
```

`.env*` files (except `.env.example`), `node_modules` and `dist` are git-ignored.

## Deploy to Vercel

1. In Vercel choose **Add New → Project** and import the GitHub repo. The Vite preset is detected; `vercel.json` already sets the build command, output directory and an SPA rewrite so that direct visits to `/projects` or `/projects/new` work.
2. Under **Settings → Environment Variables** add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` for Production (and Preview). Add only these two public values, never private credentials.
3. Deploy. Then add `https://<your-domain>/reset-password` to Supabase Redirect URLs and set the Supabase Site URL to your Vercel domain.
4. Changing env vars requires a redeploy because they are baked in at build time.

## Test the deployed app

1. Open the site; you should land on the sign-in page.
2. Sign up, confirm the email if required, and sign in. The Overview should show an empty state.
3. Create a project, then reload `/projects` directly (tests the rewrite). Edit it, then delete it with confirmation.
4. Sign out, then request a password reset and complete it from the emailed link.
5. With a second account, confirm you cannot see the first account's projects (RLS).

## Known limitations and troubleshooting

- **The SQL migration and RLS policies were reviewed but not executed against a live Postgres/Supabase instance in the build environment.** Run it in your project and do the two-account check above.
- Auth flows (sign-up, email confirmation, reset emails) depend on your Supabase project and were not exercised end to end here; tests mock the Supabase client.
- Supabase's built-in email sender is rate-limited; configure custom SMTP for real use.
- "Missing configuration" screen: `.env.local` is absent or misnamed; restart `npm run dev` after editing it.
- Reset link opens but shows an error: the link expired or the redirect URL is not in Supabase's allow-list.
- Project list errors with "permission denied": the migration was not applied, or its grants were changed.
- Only the Website Crawler is built; no Google integrations, AI recommendations or reports exist yet.
- **The crawler's Edge Function and the second migration were typechecked (Deno) and its logic unit-tested with a mock network, but never run against a live Supabase project or a real website in the build environment.** Run one crawl on a site you own and check the results.
