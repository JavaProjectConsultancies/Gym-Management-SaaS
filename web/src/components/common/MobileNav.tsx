import {
  ChevronLeft,
  ChevronRight,
  Download,
  Home,
  ScanLine,
  LogOut,
  MoreHorizontal,
  Share,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'

import Sheet from '@/components/ui/Sheet'
import { useAuth } from '@/hooks/useAuth'
import { useInstallPrompt } from '@/hooks/useInstallPrompt'
import { NAV_ITEMS } from '@/routes/navigation'
import { ROUTES } from '@/routes/paths'
import { useRouteMeta } from '@/routes/routeMeta'
import { cn } from '@/utils/cn'
import { PERMISSIONS, roleLabel } from '@/utils/permissions'

/* ------------------------------------------------------------------ */
/* Top app bar (phones)                                                */
/* ------------------------------------------------------------------ */

export function MobileAppBar() {
  const { session } = useAuth()
  const meta = useRouteMeta()
  const navigate = useNavigate()
  const location = useLocation()
  const canGoBack = Boolean(meta.back)

  function goBack() {
    // Use real history when we navigated here inside the app, else the parent screen.
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0 && location.key !== 'default') navigate(-1)
    else if (meta.back) navigate(meta.back, { replace: true })
  }

  return (
    <header className="sticky top-0 z-30 bg-sidebar pt-safe text-white shadow-[0_1px_0_rgb(255_255_255/0.06)] lg:hidden print:hidden">
      <div className="flex h-14 items-center gap-1 px-2">
        {canGoBack ? (
          <button
            type="button"
            onClick={goBack}
            className="grid size-10 place-items-center rounded-full active:bg-white/10"
            aria-label="Back"
          >
            <ChevronLeft className="size-6" aria-hidden />
          </button>
        ) : (
          <span className="ml-2 grid size-8 place-items-center rounded-lg bg-brand-500" aria-hidden>
            <img src="/favicon.svg" alt="" className="size-8 rounded-lg" />
          </span>
        )}
        <div className="min-w-0 flex-1 px-2">
          <p className="truncate text-[17px] leading-tight font-semibold">
            {meta.title ?? session?.gym?.name ?? 'Home'}
          </p>
          {!canGoBack && session?.gym && meta.title && (
            <p className="truncate text-xs text-sidebar-muted">{session.gym.name}</p>
          )}
        </div>
      </div>
    </header>
  )
}

/* ------------------------------------------------------------------ */
/* Bottom tab bar (phones)                                             */
/* ------------------------------------------------------------------ */

interface Tab {
  label: string
  to: string
  icon: LucideIcon
  permission?: string
  end?: boolean
}

const TABS: Tab[] = [
  { label: 'Home', to: ROUTES.home, icon: Home, end: true },
  {
    label: 'Check-in',
    to: ROUTES.attendance,
    icon: ScanLine,
    permission: PERMISSIONS.attendanceRead,
  },
  { label: 'Members', to: ROUTES.members, icon: Users, permission: PERMISSIONS.membersRead },
  { label: 'Payments', to: ROUTES.payments, icon: Wallet, permission: PERMISSIONS.paymentsRead },
]

export function BottomTabBar() {
  const { hasPermission } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const tabs = TABS.filter((t) => !t.permission || hasPermission(t.permission))

  const tabClass = (active: boolean) =>
    cn(
      'flex flex-1 flex-col items-center justify-center gap-0.5 pt-1.5 text-[11px] font-medium transition-colors',
      active ? 'text-brand-600' : 'text-muted',
    )

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 pb-safe backdrop-blur lg:hidden print:hidden"
      >
        <div className="flex h-[4.5rem] items-stretch pb-2">
          {tabs.map(({ label, to, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => tabClass(isActive)}>
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'grid h-8 w-14 place-items-center rounded-full transition-colors',
                      isActive && 'bg-brand-50',
                    )}
                  >
                    <Icon className="size-[22px]" strokeWidth={isActive ? 2.4 : 2} aria-hidden />
                  </span>
                  {label}
                </>
              )}
            </NavLink>
          ))}
          <button type="button" onClick={() => setMoreOpen(true)} className={tabClass(moreOpen)}>
            <span className="grid h-8 w-14 place-items-center rounded-full">
              <MoreHorizontal className="size-[22px]" aria-hidden />
            </span>
            More
          </button>
        </div>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* "More" sheet: account, upcoming modules, install, sign out          */
/* ------------------------------------------------------------------ */

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { session, user, signOut, hasPermission } = useAuth()
  const { canInstall, showIosHint, install } = useInstallPrompt()
  const [signingOut, setSigningOut] = useState(false)
  const name = session?.user.fullName ?? user?.email ?? 'Signed in'
  const upcoming = NAV_ITEMS.filter((i) => !i.available)
  // Built modules that are not bottom tabs (e.g. Memberships) are reachable from here.
  const tabPaths = new Set(TABS.map((t) => t.to))
  const extra = NAV_ITEMS.filter(
    (i) => i.available && !tabPaths.has(i.path) && (!i.permission || hasPermission(i.permission)),
  )

  return (
    <Sheet open={open} title="More" onClose={onClose} busy={signingOut}>
      <div className="flex items-center gap-3 rounded-card bg-surface-muted p-4">
        <span className="grid size-11 place-items-center rounded-full bg-brand-100 text-base font-semibold text-brand-700">
          {name.charAt(0).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate font-semibold">{name}</p>
          <p className="truncate text-sm text-muted">
            {session?.gym?.name ?? 'No gym'} · {roleLabel(session?.user.role)}
          </p>
        </div>
      </div>

      {(canInstall || showIosHint) && (
        <div className="mt-4 rounded-card border border-brand-200 bg-brand-50 p-4">
          <p className="font-medium text-brand-800">Install the app</p>
          {canInstall ? (
            <>
              <p className="mt-1 text-sm text-brand-800/80">
                Add it to your home screen for full-screen, app-like use.
              </p>
              <button
                type="button"
                onClick={() => void install()}
                className="mt-3 inline-flex items-center gap-2 rounded-control bg-brand-600 px-4 py-2 text-sm font-medium text-white active:bg-brand-700"
              >
                <Download className="size-4" aria-hidden />
                Install
              </button>
            </>
          ) : (
            <p className="mt-1 flex flex-wrap items-center gap-1 text-sm text-brand-800/80">
              In Safari, tap <Share className="inline size-4" aria-label="Share" /> then
              <strong>Add to Home Screen</strong>.
            </p>
          )}
        </div>
      )}

      {extra.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-card border border-border">
          {extra.map(({ label, path, icon: Icon }) => (
            <li key={path}>
              <Link
                to={path}
                onClick={onClose}
                className="flex items-center gap-3 px-4 py-3 font-medium active:bg-surface-muted"
              >
                <Icon className="size-5 text-brand-600" aria-hidden />
                <span className="flex-1">{label}</span>
                <ChevronRight className="size-5 text-subtle" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-5 mb-2 text-xs font-semibold tracking-wider text-muted uppercase">
        Coming soon
      </p>
      <ul className="grid grid-cols-3 gap-2">
        {upcoming.map(({ label, icon: Icon }) => (
          <li
            key={label}
            className="flex flex-col items-center gap-1.5 rounded-card border border-border px-2 py-3 text-center text-xs text-muted"
          >
            <Icon className="size-5 text-subtle" aria-hidden />
            {label}
          </li>
        ))}
      </ul>

      <button
        type="button"
        disabled={signingOut}
        onClick={async () => {
          setSigningOut(true)
          try {
            await signOut()
          } finally {
            setSigningOut(false)
          }
        }}
        className="mt-5 mb-2 flex w-full items-center justify-center gap-2 rounded-control border border-border py-3 font-medium text-danger active:bg-red-50 disabled:opacity-60"
      >
        <LogOut className="size-5" aria-hidden />
        {signingOut ? 'Signing out…' : 'Sign out'}
      </button>
    </Sheet>
  )
}
