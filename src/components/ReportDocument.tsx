import type { ReactNode } from 'react'
import { formatDate, formatDateTime } from '../lib/format'
import { EFFORT_LABELS, IMPACT_LABELS } from '../lib/recommendations'
import type { ReportSnapshot } from '../lib/reportSnapshot'
import { AREA_STATUS_LABELS } from '../lib/serviceArea'
import { formatUrlForDisplay } from '../lib/url'

const integer = new Intl.NumberFormat('en-US')

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="break-inside-avoid rounded-xl border border-line bg-surface p-6 print:rounded-none print:border-0 print:border-t print:px-0">
      <h2 className="text-lg font-semibold text-ink">{title}</h2>
      <div className="mt-4 space-y-4 text-sm text-ink-2">{children}</div>
    </section>
  )
}

function Stats({ items }: { items: readonly (readonly [string, ReactNode])[] }) {
  return (
    <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-lg bg-surface-2 px-4 py-3 print:bg-transparent print:px-0">
          <dt className="text-xs font-medium text-ink-2">{label}</dt>
          <dd className="mt-1 text-xl font-semibold text-ink tabular-nums">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

function pct(value: number | null, suffix = '%'): string {
  if (value === null) return 'new'
  return `${value > 0 ? '+' : ''}${value}${suffix}`
}

function NotIncluded({ children }: { children: ReactNode }) {
  return <p className="text-ink-3 italic">{children}</p>
}

/** The client-facing report, rendered from a saved snapshot. Print-friendly. */
export function ReportDocument({ title, snapshot }: { title: string; snapshot: ReportSnapshot }) {
  const { project } = snapshot
  return (
    <article className="space-y-6" aria-label={title}>
      <header className="relative overflow-hidden rounded-xl border border-line bg-surface p-6 print:rounded-none print:border-0 print:p-0">
        <span aria-hidden="true" className="absolute inset-y-0 left-0 w-1 bg-accent print:hidden" />
        <p className="text-sm font-medium text-accent-ink">Local SEO report</p>
        <h1 className="mt-1 text-2xl font-semibold text-ink">{title}</h1>
        <p className="mt-2 text-sm text-ink-2">
          {project.businessName ?? project.name}, {formatUrlForDisplay(project.website, 60)}
          {project.location ? `, ${project.location}` : ''}
        </p>
        <p className="mt-1 text-xs text-ink-3">Prepared {formatDateTime(snapshot.generatedAt)}</p>
      </header>

      <Section title="Priorities">
        <p>
          {snapshot.recommendations.open} open recommendations, {snapshot.recommendations.done} completed.
        </p>
        {snapshot.recommendations.top.length > 0 ? (
          <ol className="list-decimal space-y-2 pl-5">
            {snapshot.recommendations.top.map((rec) => (
              <li key={rec.title}>
                <span className="font-medium text-ink">{rec.title}</span>{' '}
                <span className="text-xs text-ink-3">
                  ({IMPACT_LABELS[rec.impact]}, {EFFORT_LABELS[rec.effort].toLowerCase()})
                </span>
                <p className="text-ink-2">{rec.detail}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p>No open recommendations.</p>
        )}
      </Section>

      <Section title="Google Search performance">
        {snapshot.searchConsole ? (
          <>
            <p>
              {formatDate(snapshot.searchConsole.period.start, { timeZone: 'UTC' })} to {formatDate(snapshot.searchConsole.period.end, { timeZone: 'UTC' })},
              compared with the 28 days before.
            </p>
            <Stats
              items={[
                ['Clicks', `${integer.format(snapshot.searchConsole.clicks)} (${pct(snapshot.searchConsole.clicksChangePct)})`],
                ['Impressions', `${integer.format(snapshot.searchConsole.impressions)} (${pct(snapshot.searchConsole.impressionsChangePct)})`],
                ['Average CTR', `${(snapshot.searchConsole.ctr * 100).toFixed(1)}%`],
                ['Average position', snapshot.searchConsole.position ? snapshot.searchConsole.position.toFixed(1) : '—'],
              ]}
            />
            <p>
              Local searches brought {integer.format(snapshot.searchConsole.localClicks)} clicks
              {snapshot.searchConsole.localShare !== null ? ` (${snapshot.searchConsole.localShare}% of all clicks)` : ''}.
            </p>
            {snapshot.searchConsole.topQueries.length > 0 ? (
              <table className="w-full text-left text-sm">
                <caption className="sr-only">Top searches</caption>
                <thead>
                  <tr className="border-b border-line text-xs text-ink-2">
                    <th scope="col" className="py-2 font-medium">Top searches</th>
                    <th scope="col" className="py-2 text-right font-medium">Clicks</th>
                    <th scope="col" className="py-2 text-right font-medium">Impressions</th>
                    <th scope="col" className="py-2 text-right font-medium">Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line-soft">
                  {snapshot.searchConsole.topQueries.map((row) => (
                    <tr key={row.query}>
                      <td className="py-1.5">{row.query}</td>
                      <td className="py-1.5 text-right tabular-nums">{integer.format(row.clicks)}</td>
                      <td className="py-1.5 text-right tabular-nums">{integer.format(row.impressions)}</td>
                      <td className="py-1.5 text-right tabular-nums">{row.position === null ? '—' : row.position.toFixed(1)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </>
        ) : (
          <NotIncluded>Search Console was not connected for this project when the report was made.</NotIncluded>
        )}
      </Section>

      <Section title="Google Business Profile">
        {snapshot.gbp ? (
          <>
            <Stats
              items={[
                ['Profile score', snapshot.gbp.score === null ? '—' : `${snapshot.gbp.score}/100`],
                ['Reviews', snapshot.gbp.reviews === null ? '—' : integer.format(snapshot.gbp.reviews)],
                ['Rating', snapshot.gbp.rating === null ? '—' : snapshot.gbp.rating.toFixed(1)],
                ['Checks to fix', snapshot.gbp.failed + snapshot.gbp.warnings],
              ]}
            />
            {snapshot.gbp.topFixes.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {snapshot.gbp.topFixes.map((fix) => (
                  <li key={fix.label}>
                    <span className="font-medium text-ink">{fix.label}:</span> {fix.detail}
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        ) : (
          <NotIncluded>Business Profile details had not been entered.</NotIncluded>
        )}
      </Section>

      <Section title="Website health">
        {snapshot.crawl ? (
          <>
            <p>Crawled {formatDate(snapshot.crawl.date)}.</p>
            <Stats
              items={[
                ['Pages checked', integer.format(snapshot.crawl.pages)],
                ['With errors', snapshot.crawl.pagesWithErrors],
                ['With warnings', snapshot.crawl.pagesWithWarnings],
                ['Clean pages', snapshot.crawl.cleanPages],
              ]}
            />
            {snapshot.crawl.topIssues.length > 0 ? (
              <ul className="list-disc space-y-1 pl-5">
                {snapshot.crawl.topIssues.map((issue) => (
                  <li key={issue.label}>
                    {issue.label}: {issue.pages} {issue.pages === 1 ? 'page' : 'pages'}
                  </li>
                ))}
              </ul>
            ) : null}
            {snapshot.audit ? (
              <>
                <h3 className="pt-2 font-semibold text-ink">Local signals on key pages</h3>
                <p>
                  {snapshot.audit.passed} checks passed, {snapshot.audit.warnings} to improve, {snapshot.audit.failed} to fix across{' '}
                  {snapshot.audit.pages} pages.
                </p>
                {snapshot.audit.topFixes.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {snapshot.audit.topFixes.map((fix) => (
                      <li key={fix.label}>
                        {fix.label}: {fix.pages} {fix.pages === 1 ? 'page' : 'pages'}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : null}
          </>
        ) : (
          <NotIncluded>The website had not been crawled.</NotIncluded>
        )}
      </Section>

      <Section title="Service-area coverage">
        {snapshot.coverage ? (
          <>
            <p>{snapshot.coverage.percent}% of service areas have a dedicated page.</p>
            <ul className="grid gap-1 sm:grid-cols-2">
              {snapshot.coverage.areas.map((area) => (
                <li key={area.name} className="flex justify-between gap-3 border-b border-line-soft py-1">
                  <span>{area.name}</span>
                  <span className={area.status === 'covered' ? 'text-good' : area.status === 'needs_work' ? 'text-warn' : 'text-bad'}>
                    {AREA_STATUS_LABELS[area.status]}
                  </span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <NotIncluded>No service areas or crawl data were available.</NotIncluded>
        )}
      </Section>

      <Section title="Business listings">
        {snapshot.listings ? (
          <>
            <Stats
              items={[
                ['Listings tracked', snapshot.listings.tracked],
                ['Live', snapshot.listings.live],
                ['Consistent', snapshot.listings.consistent],
                ['Need fixing', snapshot.listings.needFixing],
              ]}
            />
            {snapshot.listings.missingCore.length > 0 ? <p>Not yet listed on: {snapshot.listings.missingCore.join(', ')}.</p> : null}
          </>
        ) : (
          <NotIncluded>Listings were not available.</NotIncluded>
        )}
      </Section>
    </article>
  )
}
