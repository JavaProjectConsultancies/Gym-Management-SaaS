import { FirebaseError } from 'firebase/app'
import {
  browserLocalPersistence,
  browserSessionPersistence,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth'

import type { AuthError, AuthErrorCode, AuthUser } from '@/types/auth'

import { FirebaseConfigError, getFirebaseApp } from './firebaseConfig'

/**
 * Thin wrapper around the Firebase Auth SDK. Components and contexts must use
 * these functions instead of importing `firebase/auth` directly, so the auth
 * provider can be swapped or mocked in one place.
 */

let authInstance: Auth | null = null

/** Singleton Auth instance. Persistence defaults to "local" (survives refresh and restarts). */
export function getFirebaseAuth(): Auth {
  if (!authInstance) {
    // `initializeAuth` (instead of `getAuth`) avoids bundling popup/redirect code we don't use.
    authInstance = initializeAuth(getFirebaseApp(), {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
    })
  }
  return authInstance
}

export function toAuthUser(user: User): AuthUser {
  return {
    uid: user.uid,
    email: user.email,
    displayName: user.displayName,
    emailVerified: user.emailVerified,
  }
}

/**
 * Sign in with email and password.
 * @param remember `true` → persist across browser restarts; `false` → current tab session only.
 */
export async function signInWithEmail(
  email: string,
  password: string,
  remember: boolean,
): Promise<User> {
  const auth = getFirebaseAuth()
  await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
  const credential = await signInWithEmailAndPassword(auth, email, password)
  return credential.user
}

export async function signOutUser(): Promise<void> {
  await signOut(getFirebaseAuth())
}

/** Subscribe to sign-in / sign-out events. Returns an unsubscribe function. */
export function subscribeToAuthChanges(callback: (user: User | null) => void): () => void {
  return onAuthStateChanged(getFirebaseAuth(), callback)
}

/** Current user's ID token for backend calls (auto-refreshed by the SDK). */
export async function getCurrentIdToken(forceRefresh = false): Promise<string | null> {
  const user = getFirebaseAuth().currentUser
  return user ? user.getIdToken(forceRefresh) : null
}

const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  'invalid-credentials': 'Incorrect email or password. Please try again.',
  'invalid-email': 'Please enter a valid email address.',
  'user-disabled': 'This account has been disabled. Contact your gym administrator.',
  'account-deactivated':
    'Your account is inactive or not registered with a gym. Contact your gym administrator.',
  'too-many-requests':
    'Too many failed attempts. Please wait a few minutes or reset your password before trying again.',
  'network-error': 'Unable to reach the server. Check your internet connection and try again.',
  'operation-not-allowed':
    'Email/password sign-in is not enabled for this project. Contact support.',
  'configuration-error': 'Authentication is not configured correctly. Please contact support.',
  unknown: 'Something went wrong while signing in. Please try again.',
}

const FIREBASE_CODE_MAP: Record<string, AuthErrorCode> = {
  'auth/invalid-credential': 'invalid-credentials',
  'auth/invalid-login-credentials': 'invalid-credentials',
  'auth/wrong-password': 'invalid-credentials',
  'auth/user-not-found': 'invalid-credentials', // don't reveal whether the account exists
  'auth/missing-password': 'invalid-credentials',
  'auth/invalid-email': 'invalid-email',
  'auth/missing-email': 'invalid-email',
  'auth/user-disabled': 'user-disabled',
  'auth/too-many-requests': 'too-many-requests',
  'auth/network-request-failed': 'network-error',
  'auth/operation-not-allowed': 'operation-not-allowed',
  'auth/invalid-api-key': 'configuration-error',
  'auth/api-key-not-valid': 'configuration-error',
  'auth/configuration-not-found': 'configuration-error',
  'auth/app-not-authorized': 'configuration-error',
  'auth/unauthorized-domain': 'configuration-error',
}

export function createAuthError(code: AuthErrorCode): AuthError {
  return { code, message: ERROR_MESSAGES[code] }
}

/** Convert any thrown value into a user-safe {@link AuthError}. */
export function toAuthError(error: unknown): AuthError {
  if (error instanceof FirebaseConfigError) {
    return createAuthError('configuration-error')
  }
  if (error instanceof FirebaseError) {
    // Some codes carry a suffix, e.g. "auth/api-key-not-valid.-please-pass-a-valid-api-key."
    const baseCode = error.code.split('.')[0] ?? error.code
    const mapped = FIREBASE_CODE_MAP[error.code] ?? FIREBASE_CODE_MAP[baseCode]
    if (!mapped) {
      console.error('Unhandled Firebase auth error:', error.code)
    }
    return createAuthError(mapped ?? 'unknown')
  }
  console.error('Unexpected authentication error:', error)
  return createAuthError('unknown')
}
