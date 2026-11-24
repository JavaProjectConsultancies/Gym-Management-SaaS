import { CalendarClock } from 'lucide-react'

import { Badge } from '@/components/ui/Feedback'
import { formatDate } from '@/services/members/memberForm'
import { daysLeftText, usedFraction } from '@/services/memberships/membershipText'
import type { Membership, MembershipState } from '@/types/membership'
import { cn } from '@/utils/cn'
import { formatMoney } from '@/utils/format'

const STATE_META: Record<
  MembershipState,
  { label: string; tone: 'success' | 'warning' | 'danger' | 'neutral'; dot: string }
> = {
  ACTIVE: { label: 'Active', tone: 'success', dot: 'bg-brand-500' },
  EXPIRING: { label: 'Expiring soon', tone: 'warning', dot: 'bg-amber-500' },
  UPCOMING: { label: 'Upcoming', tone: 'neutral', dot: 'bg-info' },
  EXPIRED: { label: 'Expired', tone: 'danger', dot: 'bg-danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', dot: 'bg-slate-400' },
}

export function MembershipStateBadge({ state }: { state: MembershipState }) {
  const meta = STATE_META[state]
  return (
    <Badge tone={meta.tone}>
      <span className={cn('size-1.5 rounded-full', meta.dot)} aria-hidden />
      {meta.label}
    </Badge>
  )
}

/** Big card for the member's current membership. */
export function CurrentMembershipCard({ membership: m }: { membership: Membership }) {
  const used = usedFraction(m)
  const expiring = m.state === 'EXPIRING'
  return (
    <div
      className={cn(
        'rounded-card p-4 ring-1 sm:p-5',
        expiring ? 'bg-amber-50 ring-amber-200' : 'bg-brand-50 ring-brand-200',
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-muted uppercase">
            Current membership
          </p>
          <p className="mt-1 truncate text-lg font-semibold">{m.planName}</p>
        </div>
        <MembershipStateBadge state={m.state} />
      </div>
      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-white/80"
        role="progressbar"
        aria-label="Membership used"
        aria-valuenow={Math.round(used * 100)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className={cn('h-full rounded-full', expiring ? 'bg-amber-500' : 'bg-brand-500')}
          style={{ width: `${Math.max(4, used * 100)}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <CalendarClock className="size-4 text-muted" aria-hidden />
          {daysLeftText(m)}
        </span>
        <span className="text-muted">
          {formatDate(m.startDate)} – {formatDate(m.endDate)} · {formatMoney(m.price)}
        </span>
      </div>
      {(m.balanceDue ?? 0) > 0 && (
        <p className="mt-3 rounded-control bg-white/70 px-3 py-2 text-sm font-medium text-amber-800 ring-1 ring-amber-200">
          {formatMoney(m.balanceDue ?? 0)} still to pay
        </p>
      )}
    </div>
  )
}
