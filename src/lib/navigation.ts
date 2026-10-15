import type { IconName } from '../components/icons'
import { MODULES, modulePath, type ModuleId } from './modules'

export type NavItem = {
  label: string
  to: string
  icon: IconName
  /** True for modules that are not implemented in the current phase. */
  planned: boolean
  end?: boolean
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

const MODULE_ORDER: readonly ModuleId[] = [
  'crawler',
  'page-auditor',
  'service-area',
  'gbp-audit',
  'search-console',
  'listings',
  'keywords',
  'recommendations',
  'reports',
]

export const NAV_GROUPS: readonly NavGroup[] = [
  {
    label: 'Workspace',
    items: [
      { label: 'Overview', to: '/', icon: 'grid', planned: false, end: true },
      { label: 'Projects', to: '/projects', icon: 'folder', planned: false },
    ],
  },
  {
    label: 'Analysis modules',
    items: MODULE_ORDER.map((id) => ({
      label: MODULES[id].name,
      to: modulePath(id),
      icon: MODULE_ICONS[id],
      planned: true,
    })),
  },
  {
    label: 'Account',
    items: [{ label: 'Settings', to: '/settings', icon: 'settings', planned: false }],
  },
]
