import { useMatches } from 'react-router'

/**
 * Per-route metadata for the mobile app bar: `handle: { title, back }` on a
 * route in router.tsx. `back` is where the back arrow goes when there is no
 * in-app history (e.g. the page was opened from a link).
 */
export interface RouteMeta {
  title?: string
  back?: string
}

export function useRouteMeta(): RouteMeta {
  const matches = useMatches()
  for (let i = matches.length - 1; i >= 0; i--) {
    const handle = matches[i]?.handle as RouteMeta | undefined
    if (handle?.title) return handle
  }
  return {}
}
