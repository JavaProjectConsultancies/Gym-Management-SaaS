import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'

import { checkAccountAccess } from '@/services/auth/accountAccess'
import {
  clearCachedSessions,
  loadCachedSession,
  saveCachedSession,
} from '@/services/auth/sessionCache'
import { clearCache } from '@/services/cache'
import {
  createAuthError,
  getCurrentIdToken,
  signInWithEmail,
  signOutUser,
  subscribeToAuthChanges,
  toAuthError,
  toAuthUser,
} from '@/services/firebase/firebaseAuth'
import { isFirebaseConfigured, missingFirebaseEnvVars } from '@/services/firebase/firebaseConfig'
import type { SessionResponse } from '@/types/api'
import type {
  AccountAccessStatus,
  AuthContextValue,
  AuthError,
  AuthStatus,
  AuthUser,
  SignInCredentials,
} from '@/types/auth'

import { AuthContext } from './AuthContextValue'

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  accountStatus: AccountAccessStatus
  session: SessionResponse | null
}

const SIGNED_OUT: AuthState = {
  status: 'unauthenticated',
  user: null,
  accountStatus: 'unverified',
  session: null,
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    // Without config there is nothing to wait for — show the login screen with a setup notice.
    isFirebaseConfigured ? { ...SIGNED_OUT, status: 'loading' } : SIGNED_OUT,
  )
  const [sessionError, setSessionError] = useState<AuthError | null>(null)

  useEffect(() => {
    if (!isFirebaseConfigured) {
      console.error(
        `Firebase is not configured. Missing: ${missingFirebaseEnvVars.join(', ')}. See docs/AUTHENTICATION.md.`,
      )
      return
    }

    let active = true

    // Fires once on startup with the persisted session (or null), then on every sign-in/out.
    const unsubscribe = subscribeToAuthChanges((firebaseUser) => {
      if (!firebaseUser) {
        clearCache() // screen data of the previous user never survives a sign-out
        setState(SIGNED_OUT)
        return
      }

      // Open instantly with the last known session (UI only — the backend
      // authorises every request), then re-check with the server below.
      const cached = loadCachedSession(firebaseUser.uid)
      if (cached) {
        setState({
          status: 'authenticated',
          user: toAuthUser(firebaseUser),
          accountStatus: 'active',
          session: cached,
        })
      }

      void (async () => {
        try {
          const idToken = await firebaseUser.getIdToken()
          const access = await checkAccountAccess(idToken)
          if (!active) return

          if (access.status === 'deactivated') {
            clearCachedSessions()
            setSessionError(createAuthError('account-deactivated'))
            await signOutUser() // listener fires again with null → SIGNED_OUT
            return
          }

          if (access.session) saveCachedSession(firebaseUser.uid, access.session)
          setState({
            status: 'authenticated',
            user: toAuthUser(firebaseUser),
            accountStatus: access.status,
            // Server unreachable: keep the cached session so the app stays usable.
            session: access.session ?? cached ?? null,
          })
        } catch (error) {
          // Could not complete the session (e.g. token refresh failed). Fail closed.
          if (!active) return
          setSessionError(toAuthError(error))
          await signOutUser().catch(() => undefined)
          setState(SIGNED_OUT)
        }
      })()
    })

    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  const signIn = useCallback(async ({ email, password, remember }: SignInCredentials) => {
    setSessionError(null)
    try {
      await signInWithEmail(email.trim(), password, remember)
      // State is updated by the auth listener, so refresh and sign-in share one code path.
    } catch (error) {
      throw toAuthError(error)
    }
  }, [])

  const signOut = useCallback(async () => {
    clearCachedSessions()
    clearCache()
    await signOutUser()
  }, [])

  const getIdToken = useCallback(
    (forceRefresh?: boolean) =>
      isFirebaseConfigured ? getCurrentIdToken(forceRefresh) : Promise.resolve(null),
    [],
  )

  const clearSessionError = useCallback(() => setSessionError(null), [])

  // DEV ONLY: `await __devGetIdToken()` in the browser console, for backend live tests.
  // `import.meta.env.DEV` is statically false in production builds, so this is stripped.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const w = window as typeof window & { __devGetIdToken?: typeof getIdToken }
    w.__devGetIdToken = getIdToken
    return () => {
      delete w.__devGetIdToken
    }
  }, [getIdToken])

  const hasPermission = useCallback(
    (permission: string) => state.session?.permissions.includes(permission) ?? false,
    [state.session],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      isConfigured: isFirebaseConfigured,
      sessionError,
      signIn,
      signOut,
      getIdToken,
      clearSessionError,
      hasPermission,
    }),
    [state, sessionError, signIn, signOut, getIdToken, clearSessionError, hasPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
