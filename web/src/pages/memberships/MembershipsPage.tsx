import { ChevronLeft, ChevronRight, Loader2, Search, Tags } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import { Avatar } from '@/components/members/MemberBits'
import { MembershipStateBadge } from '@/components/memberships/MembershipBits'
import Button, { ButtonLink } from '@/components/ui/Button'
import { Card, EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { formatDate } from '@/services/members/memberForm'
import { cacheKeys, listMemberships } from '@/services/memberships/membershipsApi'
import { daysLeftText } from '@/services/memberships/membershipText'
import type { MembershipFilter, MembershipListResponse } from '@/types/membership'
import { cn } from '@/utils/cn'
import { formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

const PAGE_SIZE = 25
const TABS: { label: string; value: '' | MembershipFilter }[] = [
  { label: 'All', value: '' },
  { label: 'Expiring', value: 'EXPIRING' },
  { label: 'Active', value: 'ACTIVE' },
  { label: 'Upcoming', value: 'UPCOMING' },
  { label: 'Lapsed', value: 'EXPIRED' },
  { label: 'Cancelled', value: 'CANCELLED' },
]
const EMPTY_TEXT: Record<string, string> = {
  '': 'No memberships yet. Open a member and tap “Add membership”.',
  EXPIRING: 'Nobody’s membership ends in the next 7 days.',
  ACTIVE: 'No running memberships.',
  UPCOMING: 'No memberships waiting to start.',
  EXPIRED: 'No lapsed members — everyone active is covered.',
  CANCELLED: 'No cancelled memberships.',
}

export default function MembershipsPage() {
  return <GymGate>{(gym) => <MembershipList gymId={gym.gymId} />}</GymGate>
}

function MembershipList({ gymId }: { gymId: string }) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const [params, setParams] = useSearchParams()
  const stateParam = params.get('state') ?? ''
  const state = TABS.some((t) => t.value === stateParam)
    ? (stateParam as '' | MembershipFilter)
    : ''
  const search = params.get('q') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [searchInput, setSearchInput] = useState(search)

  const { data, loading, error, reload } = useAsyncData<MembershipListResponse>(
    cacheKeys.membershipList(gymId, JSON.stringify([state, search, page])),
    (signal) =>
      listMemberships(
        api,
        gymId,
        { state: state || undefined, search, page, pageSize: PAGE_SIZE },
        signal,
      ),
  )

  function update(next: { state?: string; q?: string; page?: number }) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v === '' || v === undefined || (k === 'page' && v === 1)) p.delete(k)
          else p.set(k, String(v))
        }
        return p
      },
      { replace: true },
    )
  }

  useEffect(() => {
    if (searchInput.trim() === search) return
    const t = window.setTimeout(() => update({ q: searchInput.trim(), page: 1 }), 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on input only
  }, [searchInput])

  const count = (v: '' | MembershipFilter) =>
    !data
      ? null
      : v === ''
        ? data.counts.ACTIVE + data.counts.EXPIRING + data.counts.UPCOMING
        : data.counts[v]
  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <>
      <PageHeader
        title="Memberships"
        description={
          data
            ? `${data.counts.ACTIVE + data.counts.EXPIRING} running · ${data.counts.EXPIRING} expiring this week`
            : 'Who is covered, who is due for renewal'
        }
        actions={
          hasPermission(PERMISSIONS.plansRead) && (
            <ButtonLink
              to={ROUTES.plans}
              variant="secondary"
              icon={<Tags className="size-4" aria-hidden />}
            >
              Plans
            </ButtonLink>
          )
        }
      />

      <Card>
        <div className="border-b border-border p-3 sm:p-4">
          <label className="relative block">
            <span className="sr-only">Search memberships</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Member name, phone or plan"
              maxLength={100}
              className="block w-full rounded-control border border-border bg-surface py-2 pr-9 pl-9 text-sm placeholder:text-subtle focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
            />
            {loading && data && (
              <Loader2
                className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-subtle"
                aria-label="Loading"
              />
            )}
          </label>
          {/* Horizontally scrollable chips, like a native filter bar. */}
          <div
            role="tablist"
            aria-label="Filter by state"
            className="-mx-3 mt-3 flex [scrollbar-width:none] gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:px-0"
          >
            {TABS.map((t) => {
              const active = state === t.value
              const c = count(t.value)
              return (
                <button
                  key={t.label}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => update({ state: t.value, page: 1 })}
                  className={cn(
                    'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors active:scale-95',
                    active
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-border text-muted hover:bg-surface-muted',
                  )}
                >
                  {t.label}
                  {c !== null && (
                    <span
                      className={cn(
                        'ml-1.5 tabular-nums',
                        active ? 'text-white/80' : 'text-subtle',
                      )}
                    >
                      {c}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Loading memberships…" />
        ) : data.memberships.length === 0 ? (
          <EmptyBlock
            title={search ? 'No matches' : 'Nothing here'}
            body={search ? 'Try a different search.' : EMPTY_TEXT[state]}
          />
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            <ul className="divide-y divide-border">
              {data.memberships.map((m) => (
                <li key={m.membershipId}>
                  <Link
                    to={`${ROUTES.members}/${m.memberId}`}
                    className="flex items-center gap-3 px-3 py-3 hover:bg-surface-muted active:bg-surface-muted sm:px-4"
                  >
                    <Avatar name={m.member?.fullName ?? '?'} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {m.member?.fullName ?? 'Unknown member'}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {m.planName} · {formatDate(m.startDate)} – {formatDate(m.endDate)} ·{' '}
                        {formatMoney(m.price)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <MembershipStateBadge state={m.state} />
                      <span
                        className={cn(
                          'text-xs tabular-nums',
                          m.state === 'EXPIRING' ? 'font-medium text-amber-700' : 'text-muted',
                        )}
                      >
                        {daysLeftText(m)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
            {data.total > PAGE_SIZE && (
              <nav
                aria-label="Pagination"
                className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted"
              >
                <span className="tabular-nums">
                  Page {page} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page <= 1 || loading}
                    onClick={() => update({ page: page - 1 })}
                    icon={<ChevronLeft className="size-4" aria-hidden />}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={page >= totalPages || loading}
                    onClick={() => update({ page: page + 1 })}
                  >
                    Next
                    <ChevronRight className="size-4" aria-hidden />
                  </Button>
                </div>
              </nav>
            )}
          </div>
        )}
      </Card>
    </>
  )
}
