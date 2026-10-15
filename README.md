# Local SEO Workbench

Local SEO Workbench is a SaaS workspace for SEO specialists, agencies and local business owners who manage local SEO work across several client websites. The long-term goal is to audit sites, analyse Google Business Profiles, find local ranking opportunities, monitor Search Console data, track listings and generate reports.

**This repository is Phase 1: the application foundation.** It is a real, working app (auth + project management on Supabase), but none of the SEO analysis modules exist yet.

## What Phase 1 implements

- Email/password **sign-up, sign-in, sign-out**, password-reset request and reset (recovery) flow, persistent sessions (Supabase Auth)
- Auth context, loading states, protected routes, and public-only routes that redirect signed-in users
- **Project management** (create, list, view, edit, delete with confirmation) backed by Supabase, with inline validation and URL normalisation (http/https only)
- Overview dashboard showing real project data, or an honest empty state for new accounts (no fake metrics)
- Responsive SaaS layout: persistent desktop sidebar, mobile/tablet drawer navigation, accessible forms and feedback
- Placeholder pages for planned modules, clearly marked "not implemented in this phase"
- SQL migration with `profiles` and `projects` tables, constraints, indexes, `updated_at` triggers, a hardened signup trigger and Row Level Security
- Validation utilities (project form, URL, email, password, dates, URL display, env vars) with unit and component tests
- Vercel SPA rewrites and a GitHub Actions CI workflow

## Planned (not implemented)

Website Crawler, Local Page Auditor, Service-Area Coverage, Google Business Profile Audit, Google Search Console, Business Listings, Keyword Opportunities, Recommendations and Reports. These appear in the sidebar labelled as planned and do nothing yet. No crawling, Google integration, AI or reporting exists in this phase.

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
   - *Dashboard:* open **SQL Editor**, paste the contents of `supabase/migrations/20261015000000_init_profiles_and_projects.sql`, and run it once.
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
- Phase 1 has no server-side code, so nothing can crawl sites or call Google APIs yet.
