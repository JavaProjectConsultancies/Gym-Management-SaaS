/**
 * Authentication types.
 *
 * SECURITY: everything here describes the *client's view* of the session.
 * Firebase proves identity only. Roles, tenant membership and account status
 * are decided by the backend after verifying the Firebase ID token — never
 * trust anything stored on the client for authorization.
 */

import type { SessionResponse } from './api'

/** Minimal, serialisable view of the signed-in Firebase user. */
export interface AuthUser {
  uid: string
  email: string | null
  displayName: string | null
  emailVerified: boolean
}

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated'

/**
 * Result of the backend account check (wired up in the backend phase).
 * - `unverified`: the backend check is not available yet.
 * - `active`: backend confirmed the account may use the app.
 * - `deactivated`: backend rejected the account; the session is ended.
 */
export type AccountAccessStatus = 'unverified' | 'active' | 'deactivated'

export interface AccountAccessResult {
  status: AccountAccessStatus
  /** Backend session (role, gym, permissions) when `status` is `active`. */
  session?: SessionResponse
}

/** App-level error codes, decoupled from Firebase's raw error strings. */
export type AuthErrorCode =
  | 'invalid-credentials'
  | 'invalid-email'
  | 'user-disabled'
  | 'account-deactivated'
  | 'too-many-requests'
  | 'network-error'
  | 'operation-not-allowed'
  | 'configuration-error'
  | 'unknown'

export interface AuthError {
  code: AuthErrorCode
  message: string
}

export interface SignInCredentials {
  email: string
  password: string
  /** `true` keeps the session across browser restarts; `false` ends it when the tab closes. */
  remember: boolean
}

export interface AuthContextValue {
  status: AuthStatus
  user: AuthUser | null
  accountStatus: AccountAccessStatus
  /**
   * Role, gym and permissions as reported by the backend for this session.
   * `null` when the backend could not be reached. Used to shape the UI only —
   * the backend re-checks permissions on every request.
   */
  session: SessionResponse | null
  /** UI helper: does the backend session grant this permission? */
  hasPermission: (permission: string) => boolean
  /** `false` when required Firebase env vars are missing. */
  isConfigured: boolean
  /** Error that ended the session without a user action (e.g. deactivated account). */
  sessionError: AuthError | null
  /** Resolves on success; rejects with an {@link AuthError}. */
  signIn: (credentials: SignInCredentials) => Promise<void>
  signOut: () => Promise<void>
  /** Fresh Firebase ID token to send to the backend, or `null` when signed out. */
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>
  clearSessionError: () => void
}
