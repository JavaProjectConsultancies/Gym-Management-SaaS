import {
  AlarmClock,
  ChevronRight,
  IdCard,
  ScanLine,
  Tags,
  UserPlus,
  Users,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router'

import { Card } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { cacheKeys, listMemberships } from '@/services/memberships/membershipsApi'
import type { MembershipListResponse } from '@/types/membership'
import { cn } from '@/utils/cn'
import { APP_NAME } from '@/utils/constants'
import { PERMISSIONS } from '@/utils/permissions'

function greeting(): string {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

/** Home tab: greeting, today's membership numbers, quick actions. */
export default function WelcomePage() {
  const { session, hasPermission } = useAuth()
  const api = useApi()
  const gymId = session?.gym?.dataStoreReady ? session.gym.gymId : null
  const canSeeMemberships = hasPermission(PERMISSIONS.membershipsRead)

  const stats = useAsyncData<MembershipListResponse>(
    gymId && canSeeMemberships ? cacheKeys.membershipList(gymId, 'home') : null,
    (signal) => listMemberships(api, gymId ?? '', { pageSize: 1 }, signal),
  )
  const counts = stats.data?.counts
  const firstName = session?.user.fullName.split(' ')[0]

  const actions: { label: string; to: string; icon: LucideIcon; permission: string }[] = [
    {
      label: 'Check in',
      to: ROUTES.attendance,
      icon: ScanLine,
      permission: PERMISSIONS.attendanceWrite,
    },
    {
      label: 'Add member',
      to: `${ROUTES.members}/new`,
      icon: UserPlus,
      permission: PERMISSIONS.membersWrite,
    },
    { label: 'Members', to: ROUTES.members, icon: Users, permission: PERMISSIONS.membersRead },
    {
      label: 'Memberships',
      to: ROUTES.memberships,
      icon: IdCard,
      permission: PERMISSIONS.membershipsRead,
    },
    { label: 'Plans', to: ROUTES.plans, icon: Tags, permission: PERMISSIONS.plansRead },
  ]
  const visibleActions = actions.filter((a) => hasPermission(a.permission))

  return (
    <div className="space-y-5 lg:space-y-8">
      <section className="relative overflow-hidden rounded-card bg-sidebar p-5 text-white shadow-raised sm:p-8">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-20 -right-16 size-64 rounded-full bg-brand-500/25 blur-3xl"
        />
        <p className="relative text-sm text-sidebar-muted">{greeting()}</p>
        <h1 className="relative mt-1 text-2xl text-white sm:text-3xl">
          {firstName ? `Hi, ${firstName}` : `Welcome to ${APP_NAME}`}
        </h1>
        <p className="relative mt-1 text-sm text-sidebar-foreground/80">
          {session?.gym?.name ?? APP_NAME}
        </p>

        {canSeeMemberships && gymId && (
          <div className="relative mt-5 grid grid-cols-3 gap-2 sm:max-w-lg">
            <Stat label="Running" value={counts ? counts.ACTIVE + counts.EXPIRING : null} />
            <Stat label="Expiring" value={counts?.EXPIRING ?? null} highlight />
            <Stat label="Lapsed" value={counts?.EXPIRED ?? null} />
          </div>
        )}
      </section>

      {canSeeMemberships && counts && (counts.EXPIRING > 0 || counts.EXPIRED > 0) && (
        <Card className="divide-y divide-border">
          {counts.EXPIRING > 0 && (
            <Shortcut
              to={`${ROUTES.memberships}?state=EXPIRING`}
              icon={AlarmClock}
              tone="amber"
              title={`${counts.EXPIRING} membership${counts.EXPIRING === 1 ? '' : 's'} expiring this week`}
              body="Remind them to renew"
            />
          )}
          {counts.EXPIRED > 0 && (
            <Shortcut
              to={`${ROUTES.memberships}?state=EXPIRED`}
              icon={UserX}
              tone="red"
              title={`${counts.EXPIRED} lapsed member${counts.EXPIRED === 1 ? '' : 's'}`}
              body="Active members without a running membership"
            />
          )}
        </Card>
      )}

      {visibleActions.length > 0 && (
        <section aria-labelledby="quick-actions">
          <h2 id="quick-actions" className="mb-3 text-sm font-semibold text-muted">
            Quick actions
          </h2>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {visibleActions.map(({ label, to, icon: Icon }) => (
              <li key={label}>
                <Link
                  to={to}
                  className="flex h-full flex-col items-start gap-3 rounded-card border border-border bg-surface p-4 shadow-card transition-transform hover:bg-surface-muted active:scale-[0.97]"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-brand-50 text-brand-600">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold">{label}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Stat({
  label,
  value,
  highlight,
}: {
  label: string
  value: number | null
  highlight?: boolean
}) {
  return (
    <div className="rounded-xl bg-white/5 px-3 py-2.5 ring-1 ring-white/10">
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          highlight && value ? 'text-accent-400' : 'text-white',
        )}
      >
        {value ?? '–'}
      </p>
      <p className="text-xs text-sidebar-muted">{label}</p>
    </div>
  )
}

function Shortcut({
  to,
  icon: Icon,
  tone,
  title,
  body,
}: {
  to: string
  icon: LucideIcon
  tone: 'amber' | 'red'
  title: string
  body: string
}) {
  return (
    <Link
      to={to}
      className="flex items-center gap-3 p-4 hover:bg-surface-muted active:bg-surface-muted"
    >
      <span
        className={cn(
          'grid size-10 shrink-0 place-items-center rounded-full',
          tone === 'amber' ? 'bg-amber-50 text-amber-600' : 'bg-red-50 text-danger',
        )}
      >
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted">{body}</span>
      </span>
      <ChevronRight className="size-5 text-subtle" aria-hidden />
    </Link>
  )
}
