import { ChevronLeft, ChevronRight, HandCoins, Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, useSearchParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import { Avatar } from '@/components/members/MemberBits'
import CollectPaymentSheet from '@/components/payments/CollectPaymentSheet'
import Button from '@/components/ui/Button'
import { Alert, Badge, Card, EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { addDaysIso, formatDate, todayIso } from '@/services/members/memberForm'
import { listDues, listPayments, paymentCacheKeys } from '@/services/payments/paymentsApi'
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/services/payments/paymentText'
import type { Membership } from '@/types/membership'
import type { DuesResponse, PaymentListResponse } from '@/types/payment'
import { cn } from '@/utils/cn'
import { formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

const PAGE_SIZE = 25

/** Date-range presets, computed in the browser's local calendar. */
function periods(today: string) {
  const monthStart = `${today.slice(0, 8)}01`
  const lastMonthEnd = addDaysIso(monthStart, -1)
  const lastMonthStart = `${lastMonthEnd.slice(0, 8)}01`
  return [
    { id: 'today', label: 'Today', from: today, to: today },
    { id: '7d', label: 'Last 7 days', from: addDaysIso(today, -6), to: today },
    { id: 'month', label: 'This month', from: monthStart, to: today },
    { id: 'last-month', label: 'Last month', from: lastMonthStart, to: lastMonthEnd },
  ]
}

function Tabs() {
  const tab = (active: boolean) =>
    cn(
      'flex-1 rounded-control px-3 py-1.5 text-center text-sm font-medium transition-colors sm:flex-none',
      active ? 'bg-surface text-foreground shadow-card' : 'text-muted hover:text-foreground',
    )
  return (
    <div className="mb-4 flex gap-1 rounded-card bg-slate-200/60 p-1 sm:inline-flex">
      <NavLink to={ROUTES.payments} end className={({ isActive }) => tab(isActive)}>
        Collections
      </NavLink>
      <NavLink to={ROUTES.dues} className={({ isActive }) => tab(isActive)}>
        Dues
      </NavLink>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export default function PaymentsPage() {
  return <GymGate>{(gym) => <Collections gymId={gym.gymId} />}</GymGate>
}

function Collections({ gymId }: { gymId: string }) {
  const api = useApi()
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const presets = periods(today)
  const period = presets.find((p) => p.id === params.get('period')) ?? presets[2]!
  const search = params.get('q') ?? ''
  const includeVoided = params.get('voided') === '1'
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [searchInput, setSearchInput] = useState(search)

  const { data, loading, error, reload } = useAsyncData<PaymentListResponse>(
    paymentCacheKeys.list(
      gymId,
      JSON.stringify([period.from, period.to, search, includeVoided, page]),
    ),
    (signal) =>
      listPayments(
        api,
        gymId,
        { from: period.from, to: period.to, search, includeVoided, page, pageSize: PAGE_SIZE },
        signal,
      ),
  )

  function update(next: Record<string, string | number>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v === '' || (k === 'page' && v === 1)) p.delete(k)
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

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <>
      <PageHeader title="Payments" description="Money received and money still due" />
      <Tabs />

      <div
        role="tablist"
        aria-label="Period"
        className="-mx-4 mb-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        {presets.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={p.id === period.id}
            onClick={() => update({ period: p.id, page: 1 })}
            className={cn(
              'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap active:scale-95',
              p.id === period.id
                ? 'border-brand-600 bg-brand-600 text-white'
                : 'border-border bg-surface text-muted hover:bg-surface-muted',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Totals */}
      <section className="mb-4 rounded-card bg-sidebar p-5 text-white shadow-raised">
        <p className="text-sm text-sidebar-muted">
          Collected · {formatDate(period.from)}
          {period.from !== period.to && ` – ${formatDate(period.to)}`}
        </p>
        <p className="mt-1 text-3xl font-semibold tabular-nums">
          {data ? formatMoney(data.totals.amount) : '–'}
        </p>
        <p className="text-sm text-sidebar-muted">
          {data ? `${data.totals.count} payment${data.totals.count === 1 ? '' : 's'}` : ' '}
        </p>
        {data && data.totals.amount > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {PAYMENT_METHODS.filter((m) => data.totals.byMethod[m] > 0).map((m) => (
              <span
                key={m}
                className="rounded-full bg-white/10 px-3 py-1 text-xs ring-1 ring-white/10"
              >
                {PAYMENT_METHOD_LABELS[m]} {formatMoney(data.totals.byMethod[m])}
              </span>
            ))}
          </div>
        )}
      </section>

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-3 sm:flex-row sm:items-center sm:p-4">
          <label className="relative block flex-1">
            <span className="sr-only">Search payments</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Member, phone, receipt no. or reference"
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
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={includeVoided}
              onChange={(e) => update({ voided: e.target.checked ? '1' : '', page: 1 })}
              className="size-4 accent-brand-600"
            />
            Show voided
          </label>
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Loading payments…" />
        ) : data.payments.length === 0 ? (
          <EmptyBlock
            title="No payments"
            body={search ? 'Try a different search.' : 'Nothing was recorded in this period.'}
          />
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            <ul className="divide-y divide-border">
              {data.payments.map((p) => {
                const voided = p.status === 'VOIDED'
                return (
                  <li key={p.paymentId}>
                    <Link
                      to={`${ROUTES.payments}/${p.paymentId}`}
                      className="flex items-center gap-3 px-3 py-3 hover:bg-surface-muted active:bg-surface-muted sm:px-4"
                    >
                      <Avatar name={p.member?.fullName ?? '?'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{p.member?.fullName ?? 'Unknown'}</p>
                        <p className="truncate text-xs text-muted">
                          {p.receiptNo} · {PAYMENT_METHOD_LABELS[p.method]} ·{' '}
                          {formatDate(p.paymentDate)}
                          {p.membership && ` · ${p.membership.planName}`}
                        </p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p
                          className={cn(
                            'font-semibold tabular-nums',
                            voided && 'text-muted line-through',
                          )}
                        >
                          {formatMoney(p.amount)}
                        </p>
                        {voided && <Badge tone="danger">Voided</Badge>}
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>
            {data.total > PAGE_SIZE && (
              <Pager
                page={page}
                totalPages={totalPages}
                loading={loading}
                onPage={(p) => update({ page: p })}
              />
            )}
          </div>
        )}
      </Card>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Dues                                                                */
/* ------------------------------------------------------------------ */

export function DuesPage() {
  return <GymGate>{(gym) => <Dues gymId={gym.gymId} />}</GymGate>
}

function Dues({ gymId }: { gymId: string }) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canCollect = hasPermission(PERMISSIONS.paymentsWrite)
  const [params, setParams] = useSearchParams()
  const search = params.get('q') ?? ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)
  const [searchInput, setSearchInput] = useState(search)
  const [collecting, setCollecting] = useState<Membership | null>(null)
  const [message, setMessage] = useState<{ text: string; paymentId: string } | null>(null)

  const { data, loading, error, reload } = useAsyncData<DuesResponse>(
    paymentCacheKeys.dues(gymId, JSON.stringify([search, page])),
    (signal) => listDues(api, gymId, { search, page, pageSize: PAGE_SIZE }, signal),
  )

  useEffect(() => {
    if (searchInput.trim() === search) return
    const t = window.setTimeout(
      () =>
        setParams(
          (prev) => {
            const p = new URLSearchParams(prev)
            if (searchInput.trim()) p.set('q', searchInput.trim())
            else p.delete('q')
            p.delete('page')
            return p
          },
          { replace: true },
        ),
      350,
    )
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-run on input only
  }, [searchInput])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1

  return (
    <>
      <PageHeader title="Payments" description="Money received and money still due" />
      <Tabs />

      {message && (
        <div className="mb-4">
          <Alert tone="success">
            {message.text}{' '}
            <Link to={`${ROUTES.payments}/${message.paymentId}`} className="font-medium underline">
              View receipt
            </Link>
          </Alert>
        </div>
      )}

      <section className="mb-4 rounded-card bg-amber-50 p-5 ring-1 ring-amber-200">
        <p className="text-sm text-amber-800">Total outstanding</p>
        <p className="mt-1 text-3xl font-semibold text-amber-900 tabular-nums">
          {data ? formatMoney(data.totalDue) : '–'}
        </p>
        <p className="text-sm text-amber-800/80">
          {data ? `${data.total} membership${data.total === 1 ? '' : 's'} not fully paid` : ' '}
        </p>
      </section>

      <Card>
        <div className="border-b border-border p-3 sm:p-4">
          <label className="relative block">
            <span className="sr-only">Search dues</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Member, phone or plan"
              maxLength={100}
              className="block w-full rounded-control border border-border bg-surface py-2 pr-9 pl-9 text-sm placeholder:text-subtle focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
            />
          </label>
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Loading dues…" />
        ) : data.dues.length === 0 ? (
          <EmptyBlock
            title={search ? 'No matches' : 'All paid up'}
            body={search ? 'Try a different search.' : 'No membership has money outstanding.'}
          />
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            <ul className="divide-y divide-border">
              {data.dues.map((m) => (
                <li key={m.membershipId} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <Link to={`${ROUTES.members}/${m.memberId}`} className="shrink-0">
                    <Avatar name={m.member?.fullName ?? '?'} />
                  </Link>
                  <Link to={`${ROUTES.members}/${m.memberId}`} className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.member?.fullName ?? 'Unknown'}</p>
                    <p className="truncate text-xs text-muted">
                      {m.planName} · {formatDate(m.startDate)} – {formatDate(m.endDate)} · paid{' '}
                      {formatMoney(m.amountPaid ?? 0)} of {formatMoney(m.price)}
                    </p>
                  </Link>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <span className="font-semibold text-amber-700 tabular-nums">
                      {formatMoney(m.balanceDue ?? 0)}
                    </span>
                    {canCollect && (
                      <Button
                        size="sm"
                        onClick={() => setCollecting(m)}
                        icon={<HandCoins className="size-4" aria-hidden />}
                      >
                        Collect
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {data.total > PAGE_SIZE && (
              <Pager
                page={page}
                totalPages={totalPages}
                loading={loading}
                onPage={(p) =>
                  setParams(
                    (prev) => {
                      const q = new URLSearchParams(prev)
                      if (p === 1) q.delete('page')
                      else q.set('page', String(p))
                      return q
                    },
                    { replace: true },
                  )
                }
              />
            )}
          </div>
        )}
      </Card>

      <CollectPaymentSheet
        gymId={gymId}
        membership={collecting}
        memberName={collecting?.member?.fullName ?? ''}
        onClose={() => setCollecting(null)}
        onRecorded={(payment) => {
          setCollecting(null)
          setMessage({
            text: `${formatMoney(payment.amount)} received from ${payment.member?.fullName ?? 'member'} (${payment.receiptNo}).`,
            paymentId: payment.paymentId,
          })
          reload()
        }}
      />
    </>
  )
}

function Pager({
  page,
  totalPages,
  loading,
  onPage,
}: {
  page: number
  totalPages: number
  loading: boolean
  onPage: (p: number) => void
}) {
  return (
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
          onClick={() => onPage(page - 1)}
          icon={<ChevronLeft className="size-4" aria-hidden />}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={page >= totalPages || loading}
          onClick={() => onPage(page + 1)}
        >
          Next
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </nav>
  )
}
