export type ModuleId =
  | 'crawler'
  | 'page-auditor'
  | 'service-area'
  | 'gbp-audit'
  | 'search-console'
  | 'listings'
  | 'keywords'
  | 'recommendations'
  | 'reports'

export type ModuleMeta = {
  id: ModuleId
  name: string
  /** One-sentence description of what the module is intended to do. */
  summary: string
  /** Intended capabilities. These describe the PLANNED module, not current behavior. */
  intendedFeatures: readonly string[]
}

/** Static, validated map of planned module identifiers to page metadata. */
export const MODULES: Readonly<Record<ModuleId, ModuleMeta>> = {
  crawler: {
    id: 'crawler',
    name: 'Website Crawler',
    summary: 'Will crawl a project’s website to inventory its pages and surface technical issues that affect local visibility.',
    intendedFeatures: [
      'Discover and list indexable pages for a project website',
      'Flag broken links, redirect chains, and missing titles or meta descriptions',
      'Track crawl history so changes between crawls are easy to see',
    ],
  },
  'page-auditor': {
    id: 'page-auditor',
    name: 'Local Page Auditor',
    summary: 'Will audit location and service pages for the on-page signals that matter in local search.',
    intendedFeatures: [
      'Check titles, headings, and content for location and service relevance',
      'Verify name, address, and phone (NAP) consistency on key pages',
      'Review local schema markup and internal linking',
    ],
  },
  'service-area': {
    id: 'service-area',
    name: 'Service-Area Coverage',
    summary: 'Will compare the areas a business serves against the areas its website actually covers.',
    intendedFeatures: [
      'Map target cities and neighborhoods to existing pages',
      'Highlight service areas that have no dedicated content',
      'Help prioritize which areas to cover next',
    ],
  },
  'gbp-audit': {
    id: 'gbp-audit',
    name: 'Google Business Profile Audit',
    summary: 'Will review a Google Business Profile for completeness and optimization opportunities.',
    intendedFeatures: [
      'Check categories, services, hours, and description completeness',
      'Review photos, posts, and Q&A activity',
      'Compare profile details with the website for consistency',
    ],
  },
  'search-console': {
    id: 'search-console',
    name: 'Google Search Console',
    summary: 'Will connect to Google Search Console to monitor search performance for each project.',
    intendedFeatures: [
      'Connect a verified Search Console property to a project',
      'Track queries, pages, clicks, impressions, and average position',
      'Spot local queries that are gaining or losing visibility',
    ],
  },
  listings: {
    id: 'listings',
    name: 'Business Listings',
    summary: 'Will help maintain consistent business listings across directories and citation sources.',
    intendedFeatures: [
      'Keep a record of where a business is listed',
      'Detect inconsistent names, addresses, and phone numbers',
      'Track listing clean-up tasks',
    ],
  },
  keywords: {
    id: 'keywords',
    name: 'Keyword Opportunities',
    summary: 'Will identify local keyword opportunities worth targeting for each project.',
    intendedFeatures: [
      'Combine services and locations into candidate keyword sets',
      'Use Search Console data to find queries close to ranking well',
      'Group opportunities by page, service, and area',
    ],
  },
  recommendations: {
    id: 'recommendations',
    name: 'Recommendations',
    summary: 'Will turn findings from other modules into a prioritized list of actionable next steps.',
    intendedFeatures: [
      'Consolidate issues from audits into one prioritized list',
      'Explain why each recommendation matters and how to act on it',
      'Track which recommendations have been completed',
    ],
  },
  reports: {
    id: 'reports',
    name: 'Reports',
    summary: 'Will generate shareable reports that summarize progress and findings for clients.',
    intendedFeatures: [
      'Assemble audit findings and performance data into a report',
      'Export or share reports with clients',
      'Keep a history of reports for each project',
    ],
  },
}

export const MODULE_IDS = Object.keys(MODULES) as ModuleId[]

export function isModuleId(value: unknown): value is ModuleId {
  return typeof value === 'string' && Object.hasOwn(MODULES, value)
}

/** Safe lookup: unknown ids (including prototype keys such as "constructor") return null. */
export function getModule(id: string | undefined): ModuleMeta | null {
  return isModuleId(id) ? MODULES[id] : null
}

export function modulePath(id: ModuleId): string {
  return `/modules/${id}`
}

/**
 * Modules that have been built. Each has its own page, so the `/modules/:id` placeholder route
 * redirects to it and the sidebar shows it as available rather than planned.
 */
export const IMPLEMENTED_MODULE_PATHS: Readonly<Partial<Record<ModuleId, string>>> = {
  crawler: '/crawler',
  'page-auditor': '/page-auditor',
}

export function getImplementedPath(id: ModuleId): string | null {
  return IMPLEMENTED_MODULE_PATHS[id] ?? null
}
