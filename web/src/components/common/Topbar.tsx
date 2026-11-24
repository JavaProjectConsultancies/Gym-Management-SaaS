import { Loader2, LogOut } from 'lucide-react'
import { useState } from 'react'

import { useAuth } from '@/hooks/useAuth'
import { roleLabel } from '@/utils/permissions'

/** Desktop top bar (≥ lg). Phones use MobileAppBar. */
export default function Topbar() {
  const { user, session, signOut } = useAuth()
  const [signingOut, setSigningOut] = useState(false)

  const label = session?.user.fullName ?? user?.displayName ?? user?.email ?? 'Signed in'
  const initial = label.charAt(0).toUpperCase()

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut() // ProtectedRoute redirects to /login once the listener reports sign-out.
    } catch (error) {
      console.error('Sign-out failed:', error)
      setSigningOut(false)
    }
  }

  return (
    <header className="sticky top-0 z-20 hidden h-topbar items-center gap-3 border-b border-border bg-surface/85 px-4 backdrop-blur sm:px-6 lg:flex lg:px-8 print:hidden">
      <div className="min-w-0 flex-1">
        {session?.gym && (
          <p className="truncate text-sm font-semibold text-foreground">
            {session.gym.name}
            <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-medium text-muted ring-1 ring-border">
              {roleLabel(session.user.role)}
            </span>
          </p>
        )}
      </div>

      <div className="flex min-w-0 items-center gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700"
        >
          {initial}
        </span>
        <span className="hidden max-w-56 truncate text-sm font-medium text-foreground sm:block">
          {label}
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          disabled={signingOut}
          className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-1.5 text-sm font-medium text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-60"
        >
          {signingOut ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <LogOut className="size-4" aria-hidden />
          )}
          <span className="hidden sm:inline">Sign out</span>
        </button>
      </div>
    </header>
  )
}
