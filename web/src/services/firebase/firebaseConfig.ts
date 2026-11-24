import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from 'firebase/app'

/**
 * Centralised Firebase configuration.
 *
 * Values come exclusively from `VITE_FIREBASE_*` environment variables
 * (see `web/.env.example`). Firebase web config values are public project
 * identifiers, not secrets — access is protected by Firebase Auth settings
 * and backend authorization, not by hiding these values. Never put service
 * account credentials in any frontend env file.
 */

const env = import.meta.env

const ENV_KEYS = {
  apiKey: 'VITE_FIREBASE_API_KEY',
  authDomain: 'VITE_FIREBASE_AUTH_DOMAIN',
  projectId: 'VITE_FIREBASE_PROJECT_ID',
  storageBucket: 'VITE_FIREBASE_STORAGE_BUCKET',
  messagingSenderId: 'VITE_FIREBASE_MESSAGING_SENDER_ID',
  appId: 'VITE_FIREBASE_APP_ID',
} as const satisfies Partial<Record<keyof FirebaseOptions, keyof ImportMetaEnv>>

/** Keys Firebase Auth cannot work without. */
const REQUIRED_KEYS = ['apiKey', 'authDomain', 'projectId', 'appId'] as const

function readEnv(key: keyof ImportMetaEnv): string | undefined {
  const value = env[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

export const firebaseConfig: FirebaseOptions = {
  apiKey: readEnv(ENV_KEYS.apiKey),
  authDomain: readEnv(ENV_KEYS.authDomain),
  projectId: readEnv(ENV_KEYS.projectId),
  storageBucket: readEnv(ENV_KEYS.storageBucket),
  messagingSenderId: readEnv(ENV_KEYS.messagingSenderId),
  appId: readEnv(ENV_KEYS.appId),
}

/** Names of required env vars that are missing or empty. */
export const missingFirebaseEnvVars: string[] = REQUIRED_KEYS.filter(
  (key) => !firebaseConfig[key],
).map((key) => ENV_KEYS[key])

export const isFirebaseConfigured = missingFirebaseEnvVars.length === 0

export class FirebaseConfigError extends Error {
  constructor() {
    super(
      `Firebase is not configured. Missing environment variables: ${missingFirebaseEnvVars.join(', ')}. ` +
        'Copy web/.env.example to web/.env.local and fill in the values from the Firebase console.',
    )
    this.name = 'FirebaseConfigError'
  }
}

/**
 * Returns the singleton Firebase app, initialising it on first use.
 * Reuses an existing instance so Vite hot-reloads don't re-initialise.
 */
export function getFirebaseApp(): FirebaseApp {
  if (!isFirebaseConfigured) {
    throw new FirebaseConfigError()
  }
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig)
}
