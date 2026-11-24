import { Mail, Pencil, Phone, UserCheck, UserX } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import { Avatar, StatusBadge } from '@/components/members/MemberBits'
import MemberMembershipsSection from '@/components/memberships/MemberMembershipsSection'
import MemberPaymentsSection from '@/components/payments/MemberPaymentsSection'
import MemberAttendanceSection from '@/components/attendance/MemberAttendanceSection'
import Button, { ButtonLink } from '@/components/ui/Button'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { Alert, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { ageOn, formatDate } from '@/services/members/memberForm'
import {
  getMember,
  MEMBER_ID_PATTERN,
  memberCacheKeys,
  setMemberStatus,
} from '@/services/members/membersApi'
import type { Member } from '@/types/member'
import { errorMessage } from '@/utils/errors'
import { PERMISSIONS } from '@/utils/permissions'

import type { MemberSavedState } from './MemberFormPage'

const GENDER_LABELS: Record<string, string> = { MALE: 'Male', FEMALE: 'Female', OTHER: 'Other' }

export default function MemberDetailPage() {
  const { memberId = '' } = useParams()
  return <GymGate>{(gym) => <MemberDetail gymId={gym.gymId} memberId={memberId} />}</GymGate>
}

function MemberDetail({ gymId, memberId }: { gymId: string; memberId: string }) {
  const api = useApi()
  const location = useLocation()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.membersWrite)
  const validId = MEMBER_ID_PATTERN.test(memberId)

  const {
    current: member,
    error,
    reload,
    setData: setMember,
  } = useAsyncData<Member>(validId ? memberCacheKeys.member(gymId, memberId) : null, (signal) =>
    getMember(api, gymId, memberId, signal),
  )
  const [flash, setFlash] = useState<string | null>(
    (location.state as MemberSavedState | null)?.flash ?? null,
  )
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [paymentsVersion, setPaymentsVersion] = useState(0)
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Start the timer only once the member is visible, so the message is actually seen.
  const loaded = member !== undefined
  useEffect(() => {
    if (!flash || !loaded) return
    const t = window.setTimeout(() => setFlash(null), 5000)
    return () => window.clearTimeout(t)
  }, [flash, loaded])

  if (!validId) return <ErrorBlock message="This member link is not valid." />
  if (error) return <ErrorBlock message={error} onRetry={reload} />
  if (!member) return <LoadingBlock label="Loading member…" />

  const active = member.status === 'ACTIVE'
  const age = ageOn(member.dateOfBirth)

  async function toggleStatus() {
    if (!member) return
    setStatusBusy(true)
    setStatusError(null)
    try {
      const updated = await setMemberStatus(
        api,
        gymId,
        member.memberId,
        active ? 'INACTIVE' : 'ACTIVE',
      )
      setMember(updated)
      setFlash(active ? 'Member deactivated.' : 'Member reactivated.')
      setConfirmOpen(false)
    } catch (err) {
      setStatusError(errorMessage(err))
      setConfirmOpen(false)
    } finally {
      setStatusBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title={member.fullName}
        back={{ to: ROUTES.members, label: 'All members' }}
        actions={
          canWrite && (
            <>
              <ButtonLink
                to={`${ROUTES.members}/${member.memberId}/edit`}
                variant="secondary"
                icon={<Pencil className="size-4" aria-hidden />}
              >
                Edit
              </ButtonLink>
              <Button
                variant={active ? 'secondary' : 'primary'}
                onClick={() => setConfirmOpen(true)}
                icon={
                  active ? (
                    <UserX className="size-4" aria-hidden />
                  ) : (
                    <UserCheck className="size-4" aria-hidden />
                  )
                }
              >
                {active ? 'Deactivate' : 'Reactivate'}
              </Button>
            </>
          )
        }
      />

      <div className="space-y-4 lg:space-y-6">
        {flash && <Alert tone="success">{flash}</Alert>}
        {statusError && <Alert>{statusError}</Alert>}

        <Card className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
          <Avatar name={member.fullName} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-lg font-semibold">{member.fullName}</p>
              <StatusBadge status={member.status} />
            </div>
            <p className="mt-1 text-sm text-muted">
              Member since {formatDate(member.joinDate)}
              <span className="mx-2 text-subtle">·</span>
              <span className="font-mono text-xs" title={member.memberId}>
                {member.memberId.slice(0, 12)}…
              </span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <a
              href={`tel:${member.phone}`}
              className="inline-flex items-center gap-2 rounded-control border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
            >
              <Phone className="size-4 text-muted" aria-hidden />
              <span className="tabular-nums">{member.phone}</span>
            </a>
            {member.email && (
              <a
                href={`mailto:${member.email}`}
                className="inline-flex max-w-full items-center gap-2 rounded-control border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                <Mail className="size-4 shrink-0 text-muted" aria-hidden />
                <span className="truncate">{member.email}</span>
              </a>
            )}
          </div>
        </Card>

        <MemberMembershipsSection
          gymId={gymId}
          memberId={member.memberId}
          memberName={member.fullName}
          memberActive={active}
          onMessage={setFlash}
          onPaymentRecorded={() => setPaymentsVersion((v) => v + 1)}
        />

        <MemberPaymentsSection
          gymId={gymId}
          memberId={member.memberId}
          refreshKey={paymentsVersion}
        />

        <MemberAttendanceSection
          gymId={gymId}
          memberId={member.memberId}
          memberActive={active}
          onMessage={setFlash}
        />

        <div className="grid gap-6 lg:grid-cols-2">
          <InfoCard title="Personal">
            <Info label="Trainer" value={member.trainerName} />
            <Info label="Gender" value={member.gender ? GENDER_LABELS[member.gender] : null} />
            <Info
              label="Date of birth"
              value={
                member.dateOfBirth
                  ? `${formatDate(member.dateOfBirth)}${age !== null ? ` (${age} years)` : ''}`
                  : null
              }
            />
            <Info label="Address" value={member.address} multiline />
          </InfoCard>

          <InfoCard title="Emergency contact">
            <Info label="Name" value={member.emergencyContactName} />
            <Info label="Phone" value={member.emergencyContactPhone} />
          </InfoCard>

          <InfoCard title="Notes">
            <Info label="Notes" value={member.notes} multiline hideLabel />
          </InfoCard>

          <InfoCard title="Record">
            <Info label="Joined" value={formatDate(member.joinDate)} />
            <Info label="Created" value={new Date(member.createdAt).toLocaleString()} />
            <Info label="Last updated" value={new Date(member.updatedAt).toLocaleString()} />
          </InfoCard>
        </div>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title={active ? `Deactivate ${member.fullName}?` : `Reactivate ${member.fullName}?`}
        body={
          active
            ? 'They will be hidden from the active list. Their history is kept and you can reactivate them at any time.'
            : 'They will appear in the active members list again.'
        }
        confirmLabel={active ? 'Deactivate' : 'Reactivate'}
        tone={active ? 'danger' : 'primary'}
        busy={statusBusy}
        onConfirm={() => void toggleStatus()}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

function InfoCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <dl className="mt-3 space-y-3">{children}</dl>
    </Card>
  )
}

function Info({
  label,
  value,
  multiline,
  hideLabel,
}: {
  label: string
  value: string | null | undefined
  multiline?: boolean
  hideLabel?: boolean
}) {
  return (
    <div className={hideLabel ? undefined : 'grid grid-cols-[8rem_1fr] gap-3'}>
      <dt className={hideLabel ? 'sr-only' : 'text-sm text-muted'}>{label}</dt>
      <dd
        className={
          value
            ? `text-sm text-foreground ${multiline ? 'break-words whitespace-pre-line' : 'truncate'}`
            : 'text-sm text-subtle'
        }
      >
        {value || 'Not provided'}
      </dd>
    </div>
  )
}
