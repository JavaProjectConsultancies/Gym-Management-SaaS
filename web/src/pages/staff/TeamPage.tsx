import { ChevronRight, Lock, Mail, UserPlus } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import { Avatar } from '@/components/members/MemberBits'
import Button from '@/components/ui/Button'
import { Alert, Badge, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { TextField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ApiRequestError } from '@/services/api/apiClient'
import {
  assignableRoles,
  inviteStaff,
  listStaff,
  resendInvite,
  staffCacheKeys,
  updateStaff,
} from '@/services/staff/staffApi'
import type { StaffMember, StaffRole } from '@/types/staff'
import { cn } from '@/utils/cn'
import { errorMessage } from '@/utils/errors'
import { PERMISSIONS, roleLabel } from '@/utils/permissions'

const ROLE_HELP: Record<StaffRole, string> = {
  GYM_ADMIN: 'Runs the gym: members, plans, payments, attendance, and trainers/staff.',
  TRAINER: 'Sees members and memberships, checks members in, has “My members”.',
  STAFF: 'Front desk: members, selling memberships, collecting payments, check-in.',
}

export default function TeamPage() {
  return <GymGate>{(gym) => <Team gymId={gym.gymId} />}</GymGate>
}

function Team({ gymId }: { gymId: string }) {
  const api = useApi()
  const { session, hasPermission } = useAuth()
  const myRole = session?.user.role
  const myUserId = session?.user.userId
  const canWrite = hasPermission(PERMISSIONS.staffWrite)
  const roles = assignableRoles(myRole)
  const { data, error, reload } = useAsyncData<StaffMember[]>(
    staffCacheKeys.team(gymId),
    (signal) => listStaff(api, gymId, signal),
  )
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<StaffMember | null>(null)
  const [flash, setFlash] = useState<{ tone: 'success' | 'warning'; text: string } | null>(null)

  const canEdit = (s: StaffMember) =>
    canWrite && s.userId !== myUserId && roles.includes(s.role as StaffRole)

  return (
    <>
      <PageHeader
        title="Team"
        description="Owner, admins, trainers and front-desk staff who can sign in"
        fab={
          canWrite && roles.length
            ? {
                label: 'Add to team',
                icon: <UserPlus className="size-5" aria-hidden />,
                onClick: () => setInviting(true),
              }
            : undefined
        }
      />
      {flash && (
        <div className="mb-4">
          <Alert tone={flash.tone}>{flash.text}</Alert>
        </div>
      )}

      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingBlock label="Loading team…" />
      ) : (
        <Card>
          <ul className="divide-y divide-border">
            {data.map((s) => {
              const editable = canEdit(s)
              const inactive = s.status !== 'ACTIVE'
              const Row = editable ? 'button' : 'div'
              return (
                <li key={s.userId}>
                  <Row
                    {...(editable ? { type: 'button' as const, onClick: () => setEditing(s) } : {})}
                    className={cn(
                      'flex w-full items-center gap-3 px-3 py-3 text-left sm:px-4',
                      editable && 'hover:bg-surface-muted active:bg-surface-muted',
                      inactive && 'opacity-60',
                    )}
                  >
                    <Avatar name={s.fullName} />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate font-medium">{s.fullName}</span>
                        {s.userId === myUserId && <Badge>You</Badge>}
                        {inactive && <Badge tone="danger">Deactivated</Badge>}
                      </span>
                      <span className="block truncate text-xs text-muted">{s.email}</span>
                    </span>
                    <Badge tone={s.role === 'GYM_OWNER' ? 'success' : 'neutral'}>
                      {roleLabel(s.role)}
                    </Badge>
                    {editable ? (
                      <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
                    ) : (
                      <Lock
                        className="size-4 shrink-0 text-subtle"
                        aria-label="Cannot be changed here"
                      />
                    )}
                  </Row>
                </li>
              )
            })}
          </ul>
        </Card>
      )}

      {inviting && (
        <InviteSheet
          gymId={gymId}
          roles={roles}
          onClose={() => setInviting(false)}
          onInvited={(s, sent) => {
            setInviting(false)
            reload()
            setFlash(
              sent
                ? {
                    tone: 'success',
                    text: `${s.fullName} added as ${roleLabel(s.role)}. An email to set their password was sent to ${s.email}.`,
                  }
                : {
                    tone: 'warning',
                    text: `${s.fullName} added, but the password email could not be sent. Use “Resend setup email”.`,
                  },
            )
          }}
        />
      )}
      {editing && (
        <EditSheet
          gymId={gymId}
          member={editing}
          roles={roles}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null)
            reload()
            setFlash({ tone: 'success', text })
          }}
        />
      )}
    </>
  )
}

function RolePicker({
  roles,
  value,
  onChange,
}: {
  roles: StaffRole[]
  value: StaffRole
  onChange: (r: StaffRole) => void
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Role</legend>
      <div role="radiogroup" className="space-y-2">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            role="radio"
            aria-checked={value === r}
            onClick={() => onChange(r)}
            className={cn(
              'w-full rounded-card border p-3 text-left transition-colors',
              value === r
                ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                : 'border-border hover:bg-surface-muted',
            )}
          >
            <span className="block text-sm font-semibold">{roleLabel(r)}</span>
            <span className="block text-xs text-muted">{ROLE_HELP[r]}</span>
          </button>
        ))}
      </div>
    </fieldset>
  )
}

function InviteSheet({
  gymId,
  roles,
  onClose,
  onInvited,
}: {
  gymId: string
  roles: StaffRole[]
  onClose: () => void
  onInvited: (s: StaffMember, emailSent: boolean) => void
}) {
  const api = useApi()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<StaffRole>(roles.includes('TRAINER') ? 'TRAINER' : roles[0]!)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    if (fullName.trim().length < 2) found.fullName = 'Enter their name.'
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) found.email = 'Enter a valid email.'
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length) return
    setSaving(true)
    try {
      const res = await inviteStaff(api, gymId, { fullName, email, role })
      onInvited(res.staff, res.inviteEmailSent)
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors)
      setFormError(errorMessage(err))
    }
  }

  return (
    <Sheet
      open
      title="Add to team"
      description="They get an email to set their own password, then sign in."
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form="invite-staff"
            loading={saving}
            className="flex-1 sm:flex-none"
          >
            Add &amp; send email
          </Button>
        </>
      }
    >
      <form id="invite-staff" noValidate onSubmit={submit} className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Full name"
          required
          maxLength={120}
          autoComplete="off"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
          error={errors.fullName}
        />
        <TextField
          label="Email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          hint="Must be their own email — the password link is sent there."
        />
        <RolePicker roles={roles} value={role} onChange={setRole} />
      </form>
    </Sheet>
  )
}

function EditSheet({
  gymId,
  member: s,
  roles,
  onClose,
  onSaved,
}: {
  gymId: string
  member: StaffMember
  roles: StaffRole[]
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const api = useApi()
  const [fullName, setFullName] = useState(s.fullName)
  const [role, setRole] = useState<StaffRole>(s.role as StaffRole)
  const [active, setActive] = useState(s.status === 'ACTIVE')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [resending, setResending] = useState(false)
  const [resent, setResent] = useState(false)

  async function save() {
    const patch: { fullName?: string; role?: StaffRole; status?: 'ACTIVE' | 'INACTIVE' } = {}
    if (fullName.trim() !== s.fullName) patch.fullName = fullName.trim()
    if (role !== s.role) patch.role = role
    const status = active ? 'ACTIVE' : 'INACTIVE'
    if (status !== s.status) patch.status = status
    if (!Object.keys(patch).length) return onClose()
    setSaving(true)
    setError(null)
    try {
      const u = await updateStaff(api, gymId, s.userId, patch)
      onSaved(
        patch.status === 'INACTIVE'
          ? `${u.fullName} was deactivated and can no longer sign in.`
          : patch.status === 'ACTIVE'
            ? `${u.fullName} was reactivated.`
            : `${u.fullName} saved.`,
      )
    } catch (err) {
      setSaving(false)
      setError(errorMessage(err))
    }
  }

  async function resend() {
    setResending(true)
    setError(null)
    try {
      await resendInvite(api, gymId, s.userId)
      setResent(true)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setResending(false)
    }
  }

  return (
    <Sheet
      open
      title={s.fullName}
      description={s.email}
      busy={saving}
      onClose={onClose}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={saving}
            className="flex-1 sm:flex-none"
          >
            Cancel
          </Button>
          <Button onClick={() => void save()} loading={saving} className="flex-1 sm:flex-none">
            Save
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        {resent && <Alert tone="success">Password setup email sent to {s.email}.</Alert>}
        <TextField
          label="Full name"
          required
          maxLength={120}
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <RolePicker roles={roles} value={role} onChange={setRole} />
        <label className="flex items-center justify-between gap-3 rounded-card border border-border p-3">
          <span>
            <span className="block text-sm font-medium">Can sign in</span>
            <span className="block text-xs text-muted">
              Turn off when someone leaves. Takes effect on their next action.
            </span>
          </span>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
            className="size-5 accent-brand-600"
          />
        </label>
        {s.status === 'ACTIVE' && (
          <Button
            variant="ghost"
            size="sm"
            loading={resending}
            onClick={() => void resend()}
            icon={<Mail className="size-4" aria-hidden />}
          >
            Resend setup email
          </Button>
        )}
      </div>
    </Sheet>
  )
}
