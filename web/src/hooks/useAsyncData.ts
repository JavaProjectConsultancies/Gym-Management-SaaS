import { useCallback, useEffect, useEffectEvent, useState } from 'react'

import { readCache, writeCache } from '@/services/cache'
import { errorMessage, isAbortError } from '@/utils/errors'

interface State<T> {
  /** Key of the request that produced this state. */
  key: string
  data: T | undefined
  error: string | undefined
}

export interface AsyncData<T> {
  /** Latest data to show (may be cached or belong to a previous key while loading). */
  data: T | undefined
  /** Data for the current key — fresh, or cached from an earlier visit. */
  current: T | undefined
  /** A request for the current key is in flight (data may already be shown from cache). */
  loading: boolean
  error: string | undefined
  reload: () => void
  /** Replace the data for the current key (e.g. after a successful update). */
  setData: (data: T) => void
}

/**
 * Load data whenever `key` changes (stale-while-revalidate):
 *   - data cached under `key` (services/cache.ts) is shown immediately,
 *   - a fresh request always runs, and its result replaces and re-caches it,
 *   - the previous request is aborted when the key changes.
 * Loading/error are derived from the key, so no state is set synchronously
 * inside the effect. Pass `null` as the key to skip loading.
 */
export function useAsyncData<T>(
  key: string | null,
  load: (signal: AbortSignal) => Promise<T>,
): AsyncData<T> {
  const [state, setState] = useState<State<T>>({ key: '', data: undefined, error: undefined })
  const [attempt, setAttempt] = useState(0)
  const requestKey = key === null ? null : `${key}#${attempt}`

  const run = useEffectEvent((signal: AbortSignal) => load(signal))

  useEffect(() => {
    if (requestKey === null || key === null) return
    const controller = new AbortController()
    run(controller.signal).then(
      (data) => {
        writeCache(key, data)
        setState({ key: requestKey, data, error: undefined })
      },
      (error: unknown) => {
        if (isAbortError(error) || controller.signal.aborted) return
        setState((prev) => ({ key: requestKey, data: prev.data, error: errorMessage(error) }))
      },
    )
    return () => controller.abort()
  }, [requestKey, key])

  const reload = useCallback(() => setAttempt((n) => n + 1), [])
  const setData = useCallback(
    (data: T) => {
      if (key !== null) writeCache(key, data)
      setState({ key: requestKey ?? '', data, error: undefined })
    },
    [key, requestKey],
  )

  const isCurrent = requestKey !== null && state.key === requestKey
  const cached = key !== null && !isCurrent ? readCache<T>(key) : undefined
  const current = isCurrent ? state.data : cached
  return {
    data: current ?? state.data,
    current,
    loading: requestKey !== null && !isCurrent,
    error: isCurrent ? state.error : undefined,
    reload,
    setData,
  }
}
