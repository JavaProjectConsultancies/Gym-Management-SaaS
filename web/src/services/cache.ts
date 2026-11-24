/**
 * In-memory cache for screen data (stale-while-revalidate). Lets screens the
 * user has already seen appear instantly while fresh data loads, like a native
 * app. Lives only in memory: nothing is written to disk, and it is cleared on
 * sign-out so the next user on the device never sees it.
 *
 * Keys are namespaced strings, e.g. "members:list:<gymId>:…", "member:<gymId>/<id>".
 */
const store = new Map<string, unknown>()
const MAX_ENTRIES = 200

export function readCache<T>(key: string): T | undefined {
  return store.get(key) as T | undefined
}

export function writeCache<T>(key: string, value: T): void {
  store.delete(key) // keep insertion order = recency
  store.set(key, value)
  if (store.size > MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
}

/** Drop every entry whose key starts with one of the prefixes (after a change). */
export function invalidateCache(...prefixes: string[]): void {
  for (const key of [...store.keys()]) {
    if (prefixes.some((p) => key.startsWith(p))) store.delete(key)
  }
}

export function clearCache(): void {
  store.clear()
}
