import { CalendarCheck, LogIn } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import { Badge, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ApiRequestError } from '@/services/api/apiClient'
import {
  attendanceCacheKeys,
  checkIn,
  getMemberAttendance,
} from '@/services/attendance/attendanceApi'
import { formatDate, todayIso } from '@/services/members/memberForm'
import type { MemberAttendance } from '@/types/attendance'
import { errorMessage } from '@/utils/errors'
import { formatStay, formatTime } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

/** Visits on the member profile, with a quick "Check in now". */
export default function MemberAttendanceSection({
  gymId,
  memberId,
  memberActive,
  onMessage,
}: {
  gymId: string
  memberId: string
  memberActive: boolean
  onMessage: (message: string) => void
}) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canRead = hasPermission(PERMISSIONS.attendanceRead)
  const canWrite = hasPermission(PERMISSIONS.attendanceWrite)
  const { current, error, reload } = useAsyncData<MemberAttendance>(
    canRead ? attendanceCacheKeys.member(gymId, memberId) : null,
    (signal) => getMemberAttendance(api, gymId, memberId, signal),
  )
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  if (!canRead) return null
  const visitedToday = current?.visits.some((v) => v.visitDate === todayIso()) ?? false

  async function doCheckIn() {
    setBusy(true)
    setActionError(null)
    try {
      const res = await checkIn(api, gymId, memberId)
      reload()
      onMessage(`Checked in at ${formatTime(res.attendance.checkInAt)}.`)
    } catch (err) {
      setActionError(
        err instanceof ApiRequestError && err.code === 'NO_ACTIVE_MEMBERSHIP'
          ? 'No membership is running today. Use the Check-in screen to let them in anyway, with a reason.'
          : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base">
          <CalendarCheck className="size-5 text-muted" aria-hidden />
          Attendance
        </h2>
        {canWrite && memberActive && current && !visitedToday && (
          <Button
            size="sm"
            loading={busy}
            onClick={() => void doCheckIn()}
            icon={<LogIn className="size-4" aria-hidden />}
          >
            Check in now
          </Button>
        )}
        {visitedToday && <Badge tone="success">Visited today</Badge>}
      </div>
      {actionError && <p className="mb-3 text-sm text-danger">{actionError}</p>}
      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !current ? (
        <LoadingBlock label="Loading visits…" />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-3 gap-2 text-center">
            <Mini label="Last 30 days" value={String(current.stats.last30Days)} />
            <Mini label="Last 90 days" value={String(current.stats.last90Days)} />
            <Mini
              label="Last visit"
              value={current.stats.lastVisit ? formatDate(current.stats.lastVisit) : '—'}
            />
          </div>
          {current.visits.length === 0 ? (
            <p className="text-sm text-muted">No visits in the last 90 days.</p>
          ) : (
            <ul className="divide-y divide-border rounded-card border border-border">
              {current.visits.slice(0, 10).map((v) => (
                <li
                  key={v.attendanceId}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm"
                >
                  <span className="font-medium">{formatDate(v.visitDate)}</span>
                  <span className="text-muted tabular-nums">
                    {formatTime(v.checkInAt)}
                    {v.checkOutAt
                      ? ` – ${formatTime(v.checkOutAt)} (${formatStay(v.checkInAt, v.checkOutAt)})`
                      : v.status === 'IN'
                        ? ' · in gym'
                        : ''}
                    {v.overrideReason && ' · no membership'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  )
}

function Mini({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-control bg-surface-muted px-2 py-2">
      <p className="truncate text-sm font-semibold">{value}</p>
      <p className="text-[11px] text-muted">{label}</p>
    </div>
  )
}
