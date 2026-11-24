import { ApiRequestError, apiRequest, isApiConfigured } from '@/services/api/apiClient'
import type { SessionResponse } from '@/types/api'
import type { AccountAccessResult } from '@/types/auth'

/** Backend codes meaning "this account may not use the app". */
const BLOCKING_CODES = new Set([
  'USER_NOT_REGISTERED',
  'USER_INACTIVE',
  'GYM_INACTIVE',
  'GYM_NOT_FOUND',
  'ACCOUNT_CONFLICT',
  'ACCOUNT_DISABLED',
  'TOKEN_REVOKED',
])

/**
 * Ask the backend whether this account is active (GET /auth/session).
 *
 * This is a UX check, NOT authorization: the backend re-verifies the token and
 * permissions on every request regardless of what the UI decides.
 *
 * - Backend not configured, unreachable or erroring → `unverified` (the UI keeps
 *   working; any data request is still enforced server-side).
 * - Backend says the account is blocked → `deactivated` (session is ended).
 */
export async function checkAccountAccess(idToken: string): Promise<AccountAccessResult> {
  if (!isApiConfigured) return { status: 'unverified' }

  try {
    const session = await apiRequest<SessionResponse>('GET', '/auth/session', { idToken })
    return { status: 'active', session }
  } catch (error) {
    if (error instanceof ApiRequestError && BLOCKING_CODES.has(error.code)) {
      return { status: 'deactivated' }
    }
    console.warn('Account check unavailable:', error instanceof Error ? error.message : error)
    return { status: 'unverified' }
  }
}
