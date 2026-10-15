import { describe, expect, it } from 'vitest'
import { getModule, isModuleId, MODULE_IDS, MODULES, modulePath } from '../lib/modules'
import { NAV_GROUPS } from '../lib/navigation'

describe('module map', () => {
  it('resolves every known module with matching id, name, summary, and features', () => {
    expect(MODULE_IDS).toHaveLength(9)
    for (const id of MODULE_IDS) {
      const module = getModule(id)
      expect(module?.id).toBe(id)
      expect(module?.name.length).toBeGreaterThan(0)
      expect(module?.summary.length).toBeGreaterThan(0)
      expect(module?.intendedFeatures.length).toBeGreaterThan(0)
    }
  })

  it('returns null for unknown, empty, and undefined identifiers', () => {
    expect(getModule('does-not-exist')).toBeNull()
    expect(getModule('')).toBeNull()
    expect(getModule(undefined)).toBeNull()
  })

  it('does not resolve inherited object properties', () => {
    for (const key of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(isModuleId(key)).toBe(false)
      expect(getModule(key)).toBeNull()
    }
  })

  it('builds module paths', () => {
    expect(modulePath('crawler')).toBe('/modules/crawler')
  })
})

describe('sidebar navigation', () => {
  const labels = NAV_GROUPS.flatMap((group) => group.items.map((item) => item.label))

  it('lists every required item in order', () => {
    expect(labels).toEqual([
      'Overview',
      'Projects',
      'Website Crawler',
      'Local Page Auditor',
      'Service-Area Coverage',
      'Google Business Profile Audit',
      'Google Search Console',
      'Business Listings',
      'Keyword Opportunities',
      'Recommendations',
      'Reports',
      'Settings',
    ])
  })

  it('marks exactly the module entries as planned and links each to a known module', () => {
    const items = NAV_GROUPS.flatMap((group) => group.items)
    const planned = items.filter((item) => item.planned)
    expect(planned).toHaveLength(Object.keys(MODULES).length)
    for (const item of planned) {
      expect(item.to.startsWith('/modules/')).toBe(true)
      expect(isModuleId(item.to.replace('/modules/', ''))).toBe(true)
    }
    expect(items.filter((item) => !item.planned).map((item) => item.label)).toEqual([
      'Overview',
      'Projects',
      'Settings',
    ])
  })
})
