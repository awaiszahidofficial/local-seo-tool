import { Alert } from './ui/Alert'

export function EnvErrorScreen({ errors }: { errors: readonly string[] }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <main className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-xl font-semibold text-slate-900">Configuration required</h1>
        <p className="mt-1 text-sm text-slate-600">
          Local SEO Workbench cannot start because its Supabase environment variables are missing or invalid.
        </p>
        <Alert variant="error" className="mt-5" title="Fix the following">
          <ul className="list-disc space-y-1 pl-5">
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </Alert>
        <ol className="mt-5 list-decimal space-y-1.5 pl-5 text-sm text-slate-700">
          <li>
            Copy <code className="rounded bg-slate-100 px-1 py-0.5">.env.example</code> to{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">.env.local</code>.
          </li>
          <li>
            Set <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_URL</code> and{' '}
            <code className="rounded bg-slate-100 px-1 py-0.5">VITE_SUPABASE_PUBLISHABLE_KEY</code> from your
            Supabase project (Project Settings → API).
          </li>
          <li>Restart the dev server, or redeploy if this is a hosted build.</li>
        </ol>
      </main>
    </div>
  )
}
