import { useSyncExternalStore } from 'react'
import { lastProjectStore, themeStore } from '../lib/preferences'

export function useThemePreference() {
  return useSyncExternalStore(themeStore.subscribe, themeStore.get, themeStore.get)
}

export function useLastProjectId() {
  return useSyncExternalStore(lastProjectStore.subscribe, lastProjectStore.get, lastProjectStore.get)
}
