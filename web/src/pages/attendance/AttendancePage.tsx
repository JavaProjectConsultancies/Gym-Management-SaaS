import {
  AlertTriangle,
  Ban,
  Loader2,
  LogIn,
  LogOut,
  Search,
  ShieldAlert,
  UserCheck,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import { Avatar } from '@/components/members/MemberBits'
import { MembershipStateBadge } from '@/components/memberships/MembershipBits'
import Button from '@/components/ui/Button'
import { Alert, Badge, Card, EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { TextAreaField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { ApiRequestError } from '@/services/api/apiClient'
import {
  attendanceCacheKeys,
  checkIn,
  checkOut,
  listAttendance,
  lookupMembers,
  voidVisit,
} from '@/services/attendance/attendanceApi'
import { addDaysIso, formatDate, todayIso } from '@/services/members/memberForm'
import { daysLeftText } from '@/services/memberships/membershipText'
import type {
  AttendanceListResponse,
  CheckInResponse,
  LookupResponse,
  LookupResult,
  Visit,
} from '@/types/attendance'
import { cn } from '@/utils/cn'
import { errorMessage } from '@/utils/errors'
import { formatMoney, formatStay, formatTime } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

export default function AttendancePage() {
  return <GymGate>{(gym) => <Attendance gymId={gym.gymId} />}</GymGate>
}

interface Feedback {
  tone: 'success' | 'warning' | 'danger'
  text: string
  memberId?: string
}

function Attendance({ gymId }: { gymId: string }) {
  const { hasPermission } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.attendanceWrite)
  const [feedback, setFeedback] = useState<Feedback | null>(null)
  const [version, setVersion] = useState(0)

  return (
    <>
      <PageHeader title="Check-in" description="Find a member and check them in" />
      {canWrite && (
        <CheckInPanel
          gymId={gymId}
          onDone={(f) => {
            setFeedback(f)
            setVersion((v) => v + 1)
          }}
        />
      )}
      {feedback && (
        <div className="mb-4">
          <Alert tone={feedback.tone}>
            {feedback.text}
            {feedback.memberId && (
              <>
                {' '}
                <Link
                  to={`${ROUTES.members}/${feedback.memberId}`}
                  className="font-medium underline"
                >
                  Open member
                </Link>
              </>
            )}
          </Alert>
        </div>
      )}
      <DayList gymId={gymId} version={version} onChanged={() => setVersion((v) => v + 1)} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Check-in search                                                     */
/* ------------------------------------------------------------------ */

function CheckInPanel({ gymId, onDone }: { gymId: string; onDone: (f: Feedback) => void }) {
  const api = useApi()
  const inputRef = useRef<HTMLInputElement>(null)
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [overrideFor, setOverrideFor] = useState<LookupResult | null>(null)

  // Debounce typing → lookup.
  useEffect(() => {
    const t = window.setTimeout(() => setQuery(input.trim()), 300)
    return () => window.clearTimeout(t)
  }, [input])

  const lookup = useAsyncData<LookupResponse>(
    query.length >= 2 ? `attendance:lookup:${gymId}:${query}` : null,
    (signal) => lookupMembers(api, gymId, query, signal),
  )

  function reset() {
    setInput('')
    setQuery('')
    inputRef.current?.focus()
  }

  function describe(res: CheckInResponse): Feedback {
    const name = res.attendance.member?.fullName ?? 'Member'
    const at = formatTime(res.attendance.checkInAt)
    const notes: string[] = []
    if (res.warnings.includes('BALANCE_DUE') && res.membership?.balanceDue) {
      notes.push(`${formatMoney(res.membership.balanceDue)} still to pay`)
    }
    if (res.warnings.includes('EXPIRING_SOON') && res.membership) {
      notes.push(`membership ${daysLeftText(res.membership).toLowerCase()}`)
    }
    if (res.warnings.includes('NO_ACTIVE_MEMBERSHIP')) notes.push('let in without a membership')
    return {
      tone: notes.length ? 'warning' : 'success',
      text: `${name} checked in at ${at}.${notes.length ? ` Note: ${notes.join(', ')}.` : ''}`,
      memberId: notes.length ? res.attendance.memberId : undefined,
    }
  }

  async function doCheckIn(r: LookupResult, overrideReason?: string) {
    setBusyId(r.member.memberId)
    try {
      const res = await checkIn(api, gymId, r.member.memberId, overrideReason)
      setOverrideFor(null)
      onDone(describe(res))
      reset()
    } catch (err) {
      if (err instanceof ApiRequestError && err.code === 'NO_ACTIVE_MEMBERSHIP') {
        setOverrideFor(r)
      } else {
        onDone({ tone: 'danger', text: errorMessage(err) })
        lookup.reload()
      }
      throw err
    } finally {
      setBusyId(null)
    }
  }

  async function doCheckOut(visit: Visit, name: string) {
    setBusyId(visit.memberId)
    try {
      const v = await checkOut(api, gymId, visit)
      onDone({ tone: 'success', text: `${name} checked out at ${formatTime(v.checkOutAt)}.` })
      reset()
    } catch (err) {
      onDone({ tone: 'danger', text: errorMessage(err) })
    } finally {
      setBusyId(null)
    }
  }

  const results = query.length >= 2 ? lookup.data?.results : undefined

  return (
    <Card className="mb-4 p-3 sm:p-4">
      <label className="relative block">
        <span className="sr-only">Find a member to check in</span>
        <Search
          className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-subtle"
          aria-hidden
        />
        <input
          ref={inputRef}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Name, phone or member ID"
          maxLength={100}
          className="block w-full rounded-card border border-border bg-surface py-3 pr-10 pl-11 text-base placeholder:text-subtle focus:outline-2 focus:outline-offset-0 focus:outline-brand-500"
        />
        {input && (
          <button
            type="button"
            onClick={reset}
            className="absolute top-1/2 right-2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-surface-muted"
            aria-label="Clear search"
          >
            {lookup.loading && query.length >= 2 ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <X className="size-4" aria-hidden />
            )}
          </button>
        )}
      </label>

      {query.length >= 2 &&
        (lookup.error ? (
          <p className="mt-3 text-sm text-danger">{lookup.error}</p>
        ) : !results ? (
          <p className="mt-3 text-sm text-muted">Searching…</p>
        ) : results.length === 0 ? (
          <p className="mt-3 text-sm text-muted">No member matches “{query}”.</p>
        ) : (
          <ul className="mt-3 divide-y divide-border rounded-card border border-border">
            {results.map((r) => (
              <LookupRow
                key={r.member.memberId}
                result={r}
                busy={busyId === r.member.memberId}
                onCheckIn={() => void doCheckIn(r).catch(() => undefined)}
                onOverride={() => setOverrideFor(r)}
                onCheckOut={(v) => void doCheckOut(v, r.member.fullName)}
              />
            ))}
          </ul>
        ))}

      <OverrideSheet
        result={overrideFor}
        busy={overrideFor !== null && busyId === overrideFor.member.memberId}
        onClose={() => setOverrideFor(null)}
        onConfirm={(reason) => (overrideFor ? doCheckIn(overrideFor, reason) : Promise.resolve())}
      />
    </Card>
  )
}

function LookupRow({
  result: r,
  busy,
  onCheckIn,
  onOverride,
  onCheckOut,
}: {
  result: LookupResult
  busy: boolean
  onCheckIn: () => void
  onOverride: () => void
  onCheckOut: (v: Visit) => void
}) {
  const inactive = r.member.status !== 'ACTIVE'
  const m = r.membership
  return (
    <li className="flex flex-wrap items-center gap-3 px-3 py-3">
      <Avatar name={r.member.fullName} />
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{r.member.fullName}</p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
          <span className="tabular-nums">{r.member.phone}</span>
          {inactive ? (
            <Badge>Inactive member</Badge>
          ) : m ? (
            <>
              <MembershipStateBadge state={m.state} />
              <span>{daysLeftText(m)}</span>
              {(m.balanceDue ?? 0) > 0 && (
                <Badge tone="warning">{formatMoney(m.balanceDue ?? 0)} due</Badge>
              )}
            </>
          ) : (
            <Badge tone="danger">
              No membership
              {r.lastMembershipEnd ? ` · ended ${formatDate(r.lastMembershipEnd)}` : ''}
            </Badge>
          )}
        </div>
      </div>
      <div className="flex w-full justify-end gap-2 sm:w-auto">
        {r.today ? (
          r.today.status === 'IN' ? (
            <>
              <span className="self-center text-xs font-medium text-brand-700">
                In since {formatTime(r.today.checkInAt)}
              </span>
              <Button
                size="sm"
                variant="secondary"
                loading={busy}
                onClick={() => r.today && onCheckOut(r.today)}
                icon={<LogOut className="size-4" aria-hidden />}
              >
                Check out
              </Button>
            </>
          ) : (
            <span className="text-xs text-muted">
              Visited today · left {formatTime(r.today.checkOutAt)}
            </span>
          )
        ) : inactive ? (
          <span className="text-xs text-muted">Reactivate to check in</span>
        ) : m ? (
          <Button
            loading={busy}
            onClick={onCheckIn}
            icon={<LogIn className="size-4" aria-hidden />}
            className="w-full sm:w-auto"
          >
            Check in
          </Button>
        ) : (
          <Button
            variant="secondary"
            loading={busy}
            onClick={onOverride}
            icon={<ShieldAlert className="size-4 text-amber-600" aria-hidden />}
            className="w-full sm:w-auto"
          >
            Check in anyway
          </Button>
        )}
      </div>
    </li>
  )
}

function OverrideSheet({
  result,
  busy,
  onClose,
  onConfirm,
}: {
  result: LookupResult | null
  busy: boolean
  onClose: () => void
  onConfirm: (reason: string) => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (reason.trim().length < 3) {
      setError('Say why they may enter (at least 3 characters).')
      return
    }
    setError(null)
    try {
      await onConfirm(reason)
      setReason('')
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  return (
    <Sheet
      open={result !== null}
      title="Check in without a membership?"
      description={result?.member.fullName}
      busy={busy}
      onClose={() => {
        setError(null)
        onClose()
      }}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button onClick={() => void confirm()} loading={busy} className="flex-1 sm:flex-none">
            Check in anyway
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Alert tone="warning" title="No membership is running today">
          {result?.lastMembershipEnd
            ? `Their last membership ended on ${formatDate(result.lastMembershipEnd)}.`
            : 'They have no running membership on record (cancelled ones are not counted).'}{' '}
          The reason is recorded with the visit.
        </Alert>
        {error && <Alert>{error}</Alert>}
        <TextAreaField
          label="Reason"
          required
          rows={2}
          maxLength={300}
          placeholder="e.g. Renewing at the desk today"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Sheet>
  )
}

/* ------------------------------------------------------------------ */
/* Day list                                                            */
/* ------------------------------------------------------------------ */

function DayList({
  gymId,
  version,
  onChanged,
}: {
  gymId: string
  version: number
  onChanged: () => void
}) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.attendanceWrite)
  const canVoid = hasPermission(PERMISSIONS.attendanceVoid)
  const [params, setParams] = useSearchParams()
  const today = todayIso()
  const dateParam = params.get('date')
  const date =
    dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) && dateParam <= today ? dateParam : today
  const filter =
    params.get('show') === 'in' ? 'IN' : params.get('show') === 'out' ? 'OUT' : undefined
  const [busyId, setBusyId] = useState<string | null>(null)
  const [voiding, setVoiding] = useState<Visit | null>(null)
  const [error, setError] = useState<string | null>(null)

  const {
    data,
    loading,
    error: loadError,
    reload,
  } = useAsyncData<AttendanceListResponse>(
    attendanceCacheKeys.day(gymId, JSON.stringify([date, filter, version])),
    (signal) => listAttendance(api, gymId, { date, status: filter }, signal),
  )

  function set(next: Record<string, string>) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [k, v] of Object.entries(next)) {
          if (v) p.set(k, v)
          else p.delete(k)
        }
        return p
      },
      { replace: true },
    )
  }

  async function doCheckOut(v: Visit) {
    setBusyId(v.attendanceId)
    setError(null)
    try {
      await checkOut(api, gymId, v)
      onChanged()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusyId(null)
    }
  }

  const isToday = date === today
  const chip = (active: boolean) =>
    cn(
      'shrink-0 rounded-full border px-3 py-1.5 text-sm font-medium whitespace-nowrap active:scale-95',
      active
        ? 'border-brand-600 bg-brand-600 text-white'
        : 'border-border bg-surface text-muted hover:bg-surface-muted',
    )

  return (
    <section aria-labelledby="day-heading">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 id="day-heading" className="mr-auto text-base">
          {isToday ? 'Today' : formatDate(date)}
        </h2>
        <button type="button" className={chip(isToday)} onClick={() => set({ date: '' })}>
          Today
        </button>
        <button
          type="button"
          className={chip(date === addDaysIso(today, -1))}
          onClick={() => set({ date: addDaysIso(today, -1) })}
        >
          Yesterday
        </button>
        <label className="sr-only" htmlFor="att-date">
          Pick a date
        </label>
        <input
          id="att-date"
          type="date"
          max={today}
          value={date}
          onChange={(e) => set({ date: e.target.value === today ? '' : e.target.value })}
          className="rounded-full border border-border bg-surface px-3 py-1 text-sm text-muted"
        />
      </div>

      <div className="mb-3 grid grid-cols-3 gap-2">
        <Stat label={isToday ? 'In the gym now' : 'Still in'} value={data?.counts.in} highlight />
        <Stat label="Visits" value={data?.counts.total} />
        <Stat label="Without membership" value={data?.counts.overrides} />
      </div>

      {error && (
        <div className="mb-3">
          <Alert>{error}</Alert>
        </div>
      )}

      <Card>
        <div
          role="tablist"
          aria-label="Filter visits"
          className="flex gap-1 border-b border-border p-2"
        >
          {[
            { id: '', label: 'All' },
            { id: 'in', label: 'In gym' },
            { id: 'out', label: 'Left' },
          ].map((t) => {
            const active = (params.get('show') ?? '') === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => set({ show: t.id })}
                className={cn(
                  'rounded-control px-3 py-1.5 text-sm font-medium',
                  active ? 'bg-brand-50 text-brand-700' : 'text-muted hover:bg-surface-muted',
                )}
              >
                {t.label}
              </button>
            )
          })}
          {loading && data && (
            <Loader2
              className="ml-auto size-4 animate-spin self-center text-subtle"
              aria-label="Loading"
            />
          )}
        </div>

        {loadError ? (
          <ErrorBlock message={loadError} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Loading visits…" />
        ) : data.attendance.length === 0 ? (
          <EmptyBlock
            title="No visits"
            body={isToday ? 'Check-ins will appear here.' : 'Nobody visited on this day.'}
          />
        ) : (
          <ul className="divide-y divide-border">
            {data.attendance.map((v) => (
              <li key={v.attendanceId} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                <Link to={`${ROUTES.members}/${v.memberId}`} className="shrink-0">
                  <Avatar name={v.member?.fullName ?? '?'} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`${ROUTES.members}/${v.memberId}`}
                    className="block truncate font-medium hover:text-brand-700"
                  >
                    {v.member?.fullName ?? 'Unknown'}
                  </Link>
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted tabular-nums">
                    <span>In {formatTime(v.checkInAt)}</span>
                    {v.checkOutAt && (
                      <span>
                        · Out {formatTime(v.checkOutAt)} ({formatStay(v.checkInAt, v.checkOutAt)})
                      </span>
                    )}
                    {v.overrideReason && (
                      <Badge tone="warning">
                        <AlertTriangle className="size-3" aria-hidden />
                        No membership: {v.overrideReason}
                      </Badge>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {v.status === 'IN' ? (
                    canWrite && isToday ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={busyId === v.attendanceId}
                        onClick={() => void doCheckOut(v)}
                        icon={<LogOut className="size-4" aria-hidden />}
                      >
                        Check out
                      </Button>
                    ) : (
                      <Badge tone="success">
                        <UserCheck className="size-3" aria-hidden />
                        In
                      </Badge>
                    )
                  ) : (
                    <Badge>Left</Badge>
                  )}
                  {canVoid && (
                    <button
                      type="button"
                      onClick={() => setVoiding(v)}
                      className="grid size-9 place-items-center rounded-full text-subtle hover:bg-red-50 hover:text-danger"
                      aria-label={`Void visit of ${v.member?.fullName ?? 'member'}`}
                    >
                      <Ban className="size-4" aria-hidden />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <VoidVisitSheet
        gymId={gymId}
        visit={voiding}
        onClose={() => setVoiding(null)}
        onVoided={() => {
          setVoiding(null)
          onChanged()
        }}
      />
    </section>
  )
}

function Stat({ label, value, highlight }: { label: string; value?: number; highlight?: boolean }) {
  return (
    <div
      className={cn(
        'rounded-card p-3 ring-1',
        highlight ? 'bg-brand-50 ring-brand-200' : 'bg-surface ring-border',
      )}
    >
      <p
        className={cn(
          'text-2xl font-semibold tabular-nums',
          highlight ? 'text-brand-700' : 'text-foreground',
        )}
      >
        {value ?? '–'}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}

function VoidVisitSheet({
  gymId,
  visit,
  onClose,
  onVoided,
}: {
  gymId: string
  visit: Visit | null
  onClose: () => void
  onVoided: () => void
}) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!visit) return
    if (reason.trim().length < 3) {
      setError('Please give a reason (at least 3 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await voidVisit(api, gymId, visit, reason)
      setReason('')
      onVoided()
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={visit !== null}
      title="Void this visit?"
      description={
        visit ? `${visit.member?.fullName ?? ''} · in ${formatTime(visit.checkInAt)}` : undefined
      }
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            loading={busy}
            className="flex-1 sm:flex-none"
          >
            Void visit
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-muted">
          For mistakes (wrong member checked in). The visit stays in the records as voided and the
          member can be checked in again today.
        </p>
        <TextAreaField
          label="Reason"
          required
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Sheet>
  )
}
