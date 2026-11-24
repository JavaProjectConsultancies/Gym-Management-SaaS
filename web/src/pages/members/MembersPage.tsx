import { ChevronLeft, ChevronRight, Loader2, Phone, Search, UserPlus } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import Button, { ButtonLink } from '@/components/ui/Button'
import { Avatar, StatusBadge } from '@/components/members/MemberBits'
import { Card, EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { listMembers, memberCacheKeys } from '@/services/members/membersApi'
import { formatDate } from '@/services/members/memberForm'
import { ROUTES } from '@/routes/paths'
import type { MemberListResponse, MemberStatus } from '@/types/member'
import { cn } from '@/utils/cn'
import { PERMISSIONS } from '@/utils/permissions'

const PAGE_SIZE = 25
const STATUS_TABS: {
  label: string
  value: '' | MemberStatus
  count: 'all' | 'active' | 'inactive'
}[] = [
  { label: 'All', value: '', count: 'all' },
  { label: 'Active', value: 'ACTIVE', count: 'active' },
  { label: 'Inactive', value: 'INACTIVE', count: 'inactive' },
]

export default function MembersPage() {
  return <GymGate>{(gym) => <MembersList gymId={gym.gymId} />}</GymGate>
}

function MembersList({ gymId }: { gymId: string }) {
  const api = useApi()
  const navigate = useNavigate()
  const { hasPermission, session } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.membersWrite)

  // Filters live in the URL so Back and shared links keep them.
  const [params, setParams] = useSearchParams()
  const isTrainer = session?.user.role === 'TRAINER'
  const mine = isTrainer && params.get('mine') !== '0' // trainers see their own members first
  const trainerId = mine ? session?.user.userId : undefined
  const search = params.get('q') ?? ''
  const statusParam = params.get('status')
  const status: '' | MemberStatus =
    statusParam === 'ACTIVE' || statusParam === 'INACTIVE' ? statusParam : ''
  const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1)

  const [searchInput, setSearchInput] = useState(search)
  const { data, loading, error, reload } = useAsyncData<MemberListResponse>(
    memberCacheKeys.list(gymId, JSON.stringify([search, status, page, trainerId ?? ''])),
    (signal) =>
      listMembers(
        api,
        gymId,
        { search, status: status || undefined, page, pageSize: PAGE_SIZE, trainerId },
        signal,
      ),
  )

  function updateParams(next: { q?: string; status?: string; page?: number; mine?: string }) {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        for (const [key, value] of Object.entries(next)) {
          if (value === '' || value === undefined || (key === 'page' && value === 1)) p.delete(key)
          else p.set(key, String(value))
        }
        return p
      },
      { replace: true },
    )
  }

  // Debounce typing into the URL (and therefore into requests).
  useEffect(() => {
    if (searchInput.trim() === search) return
    const t = window.setTimeout(() => updateParams({ q: searchInput.trim(), page: 1 }), 350)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- updateParams is stable enough; re-run on input only
  }, [searchInput])

  const totalPages = data ? Math.max(1, Math.ceil(data.total / PAGE_SIZE)) : 1
  const first = data && data.total > 0 ? (page - 1) * PAGE_SIZE + 1 : 0
  const last = data ? Math.min(page * PAGE_SIZE, data.total) : 0

  return (
    <>
      <PageHeader
        title="Members"
        description={
          data
            ? `${data.counts.all} member${data.counts.all === 1 ? '' : 's'} · ${data.counts.active} active`
            : 'Everyone registered at your gym'
        }
        fab={
          canWrite
            ? {
                to: `${ROUTES.members}/new`,
                label: 'Add member',
                icon: <UserPlus className="size-5" aria-hidden />,
              }
            : undefined
        }
      />

      <Card>
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
          {isTrainer && (
            <div role="tablist" aria-label="Whose members" className="flex gap-1 sm:order-last">
              {[
                { id: '1', label: 'My members' },
                { id: '0', label: 'Everyone' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={(mine ? '1' : '0') === t.id}
                  onClick={() => updateParams({ mine: t.id === '1' ? '' : '0', page: 1 })}
                  className={cn(
                    'rounded-full border px-3 py-1 text-sm font-medium',
                    (mine ? '1' : '0') === t.id
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-border text-muted',
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <div role="tablist" aria-label="Filter by status" className="flex gap-1">
            {STATUS_TABS.map((tab) => {
              const active = status === tab.value
              return (
                <button
                  key={tab.label}
                  role="tab"
                  type="button"
                  aria-selected={active}
                  onClick={() => updateParams({ status: tab.value, page: 1 })}
                  className={cn(
                    'rounded-control px-3 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-muted hover:bg-surface-muted hover:text-foreground',
                  )}
                >
                  {tab.label}
                  {data && (
                    <span className="ml-1.5 text-xs text-subtle tabular-nums">
                      {data.counts[tab.count]}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <label className="relative block w-full sm:w-72">
            <span className="sr-only">Search members</span>
            <Search
              className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
              aria-hidden
            />
            <input
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Name, phone, email or ID"
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
        </div>

        {error ? (
          <ErrorBlock message={error} onRetry={reload} />
        ) : !data ? (
          <LoadingBlock label="Loading members…" />
        ) : data.members.length === 0 ? (
          search || status ? (
            <EmptyBlock
              title="No matching members"
              body="Try a different search or filter."
              action={
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearchInput('')
                    updateParams({ q: '', status: '', page: 1 })
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          ) : (
            <EmptyBlock
              title="No members yet"
              body="Add your first member to start tracking memberships, payments and attendance."
              action={
                canWrite && (
                  <ButtonLink to={`${ROUTES.members}/new`} size="sm">
                    Add member
                  </ButtonLink>
                )
              }
            />
          )
        ) : (
          <div className={cn('transition-opacity', loading && 'opacity-60')}>
            {/* Desktop table */}
            <table className="hidden w-full text-left text-sm md:table">
              <thead className="border-b border-border bg-surface-muted text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-4 py-3">
                    Member
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Phone
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Joined
                  </th>
                  <th scope="col" className="px-4 py-3">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.members.map((m) => (
                  <tr
                    key={m.memberId}
                    onClick={() => navigate(`${ROUTES.members}/${m.memberId}`)}
                    className="cursor-pointer hover:bg-surface-muted"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <Avatar name={m.fullName} />
                        <div className="min-w-0">
                          <Link
                            to={`${ROUTES.members}/${m.memberId}`}
                            onClick={(e) => e.stopPropagation()}
                            className="block truncate font-medium text-foreground hover:text-brand-700"
                          >
                            {m.fullName}
                          </Link>
                          <p className="truncate text-xs text-muted">{m.email ?? 'No email'}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted tabular-nums">{m.phone}</td>
                    <td className="px-4 py-3 text-muted">{formatDate(m.joinDate)}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Mobile list */}
            <ul className="divide-y divide-border md:hidden">
              {data.members.map((m) => (
                <li key={m.memberId}>
                  <Link
                    to={`${ROUTES.members}/${m.memberId}`}
                    className="flex items-center gap-3 px-4 py-3 hover:bg-surface-muted"
                  >
                    <Avatar name={m.fullName} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{m.fullName}</p>
                      <p className="flex items-center gap-1 text-xs text-muted tabular-nums">
                        <Phone className="size-3" aria-hidden />
                        {m.phone}
                      </p>
                    </div>
                    <StatusBadge status={m.status} />
                  </Link>
                </li>
              ))}
            </ul>

            <nav
              aria-label="Pagination"
              className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted"
            >
              <span className="tabular-nums">
                {first}–{last} of {data.total}
              </span>
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => updateParams({ page: page - 1 })}
                  icon={<ChevronLeft className="size-4" aria-hidden />}
                >
                  Previous
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => updateParams({ page: page + 1 })}
                >
                  Next
                  <ChevronRight className="size-4" aria-hidden />
                </Button>
              </div>
            </nav>
          </div>
        )}
      </Card>
    </>
  )
}
