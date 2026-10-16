import type { IconName } from '../components/icons'
import { MODULES, getImplementedPath, modulePath, type ModuleId } from './modules'

export type NavItem = {
  label: string
  to: string
  icon: IconName
  /** True for modules that are not implemented in the current phase. */
  planned: boolean
  end?: boolean
  /** True for module pages that act on the currently selected project. */
  projectScoped?: boolean
}

export type NavGroup = {
  label: string
  items: readonly NavItem[]
}

const MODULE_ICONS: Record<ModuleId, IconName> = {
  crawler: 'globe',
  'page-auditor': 'file-check',
  'service-area': 'map',
  'gbp-audit': 'pin',
  'search-console': 'search',
  listings: 'list',
  keywords: 'trending',
  recommendations: 'lightbulb',
  reports: 'report',
}

/** Modules grouped by the job they do for a local business. */
const MODULE_GROUPS: readonly { label: string; ids: readonly ModuleId[] }[] = [
  { label: 'Website', ids: ['crawler', 'page-auditor', 'service-area'] },
  { label: 'Local presence', ids: ['gbp-audit', 'listings'] },
  { label: 'Search', ids: ['search-console', 'keywords'] },
  { label: 'Deliver', ids: ['recommendations', 'reports'] },
]

function moduleItem(id: ModuleId): NavItem {
  const implementedPath = getImplementedPath(id)
  return {
    label: MODULES[id].name,
    to: implementedPath ?? modulePath(id),
    icon: MODULE_ICONS[id],
    planned: implementedPath === null,
    projectScoped: true,
  }
}

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', to: '/', icon: 'grid', planned: false, end: true },
      { label: 'Projects', to: '/projects', icon: 'folder', planned: false },
    ],
  },
  ...MODULE_GROUPS.map((group) => ({ label: group.label, items: group.ids.map(moduleItem) })),
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: 'settings', planned: false }],
  },
]

/** Paths of pages that work on one project chosen with ?project=<id>. */
export const PROJECT_SCOPED_PATHS: ReadonlySet<string> = new Set(
  NAV_GROUPS.flatMap((group) => group.items.filter((item) => item.projectScoped).map((item) => item.to)),
)
