import { useCallback } from 'react'

import { ApiRequestError, apiRequest } from '@/services/api/apiClient'
import type { HttpMethod } from '@/types/api'

import { useAuth } from './useAuth'

export type ApiCaller = <T>(
  method: HttpMethod,
  path: string,
  body?: Record<string, unknown>,
  signal?: AbortSignal,
) => Promise<T>

/**
 * Authenticated API calls: attaches a fresh Firebase ID token to every request.
 * If the backend rejects the token as expired, retries once with a forced refresh.
 */
export function useApi(): ApiCaller {
  const { getIdToken } = useAuth()

  return useCallback(
    async <T>(
      method: HttpMethod,
      path: string,
      body?: Record<string, unknown>,
      signal?: AbortSignal,
    ) => {
      const idToken = await getIdToken()
      try {
        return await apiRequest<T>(method, path, { idToken, body, signal })
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === 'TOKEN_EXPIRED') {
          const fresh = await getIdToken(true)
          return apiRequest<T>(method, path, { idToken: fresh, body, signal })
        }
        throw error
      }
    },
    [getIdToken],
  )
}
