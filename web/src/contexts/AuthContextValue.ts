import { createContext } from 'react'

import type { AuthContextValue } from '@/types/auth'

/**
 * Context object, kept separate from the provider component so React Fast
 * Refresh works (a file should export only components). Consume via `useAuth()`.
 */
export const AuthContext = createContext<AuthContextValue | null>(null)
