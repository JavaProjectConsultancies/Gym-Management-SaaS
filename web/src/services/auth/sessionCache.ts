import type { SessionResponse } from '@/types/api'

/**
 * Remembers the last backend session (role, gym name, permissions) per
 * Firebase user, so the app can open instantly on the next visit instead of
 * waiting for the server. The session is always re-checked in the background
 * and replaced (or the user signed out) when the server disagrees.
 *
 * SECURITY: this only shapes the UI. Every API request is still authorised by
 * the backend from its own database, so editing this value grants nothing.
 * It holds no tokens or passwords and is removed on sign-out.
 */
const PREFIX = 'gms.session.'

export function loadCachedSession(uid: string): SessionResponse | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + uid)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SessionResponse
    return parsed && Array.isArray(parsed.permissions) && parsed.user ? parsed : null
  } catch {
    return null
  }
}

export function saveCachedSession(uid: string, session: SessionResponse): void {
  try {
    window.localStorage.setItem(PREFIX + uid, JSON.stringify(session))
  } catch {
    // Storage full or disabled (private mode): the app just starts a bit slower.
  }
}

export function clearCachedSessions(): void {
  try {
    for (let i = window.localStorage.length - 1; i >= 0; i--) {
      const key = window.localStorage.key(i)
      if (key?.startsWith(PREFIX)) window.localStorage.removeItem(key)
    }
  } catch {
    // ignore
  }
}
