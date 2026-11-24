import { Save } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import Button, { ButtonLink } from '@/components/ui/Button'
import { Alert, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { SelectField, TextAreaField, TextField } from '@/components/ui/Field'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { ROUTES } from '@/routes/paths'
import { ApiRequestError } from '@/services/api/apiClient'
import {
  EMPTY_MEMBER_FORM,
  memberToFormValues,
  todayIso,
  toCreatePayload,
  toUpdatePayload,
  validateMemberForm,
} from '@/services/members/memberForm'
import {
  createMember,
  getMember,
  MEMBER_ID_PATTERN,
  memberCacheKeys,
  updateMember,
} from '@/services/members/membersApi'
import type { MemberFormErrors, MemberFormField, MemberFormValues } from '@/types/member'
import type { TrainerOption } from '@/types/staff'
import { listTrainers, staffCacheKeys } from '@/services/staff/staffApi'
import { errorMessage } from '@/utils/errors'

export interface MemberSavedState {
  flash?: string
}

/** /members/new and /members/:memberId/edit */
export default function MemberFormPage() {
  const { memberId } = useParams()
  return (
    <GymGate>
      {(gym) =>
        memberId ? (
          <EditMember gymId={gym.gymId} memberId={memberId} />
        ) : (
          <MemberForm gymId={gym.gymId} initial={{ ...EMPTY_MEMBER_FORM, joinDate: todayIso() }} />
        )
      }
    </GymGate>
  )
}

function EditMember({ gymId, memberId }: { gymId: string; memberId: string }) {
  const api = useApi()
  const validId = MEMBER_ID_PATTERN.test(memberId)
  const { current, error, reload } = useAsyncData(
    validId ? memberCacheKeys.member(gymId, memberId) : null,
    (signal) => getMember(api, gymId, memberId, signal),
  )

  if (!validId) return <ErrorBlock message="This member link is not valid." />
  if (error) return <ErrorBlock message={error} onRetry={reload} />
  if (!current) return <LoadingBlock label="Loading member…" />
  // key: a fresh form if the user navigates to another member's edit page.
  return (
    <MemberForm
      key={current.memberId}
      gymId={gymId}
      memberId={memberId}
      initial={memberToFormValues(current)}
    />
  )
}

interface MemberFormProps {
  gymId: string
  memberId?: string
  initial: MemberFormValues
}

function MemberForm({ gymId, memberId, initial }: MemberFormProps) {
  const api = useApi()
  const trainers = useAsyncData<TrainerOption[]>(staffCacheKeys.trainers(gymId), (signal) =>
    listTrainers(api, gymId, signal),
  )
  const navigate = useNavigate()
  const isEdit = Boolean(memberId)

  const [values, setValues] = useState<MemberFormValues>(initial)
  const [errors, setErrors] = useState<MemberFormErrors>({})
  const [formError, setFormError] = useState<ReactNode>(null)
  const [saving, setSaving] = useState(false)
  const errorRef = useRef<HTMLDivElement>(null)

  // The submit button is at the bottom of a long form: bring any error into view.
  useEffect(() => {
    if (!formError) return
    errorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    errorRef.current?.focus({ preventScroll: true })
  }, [formError])

  const detailPath = memberId ? `${ROUTES.members}/${memberId}` : ROUTES.members

  function set<K extends MemberFormField>(field: K, value: MemberFormValues[K]) {
    setValues((v) => ({ ...v, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setFormError(null)
    const found = validateMemberForm(values)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      setFormError('Please fix the highlighted fields.')
      return
    }

    setSaving(true)
    try {
      let saved
      if (memberId) {
        const payload = toUpdatePayload(initial, values)
        if (Object.keys(payload).length === 0) {
          navigate(detailPath)
          return
        }
        saved = await updateMember(api, gymId, memberId, payload)
      } else {
        saved = await createMember(api, gymId, toCreatePayload(values))
      }
      const state: MemberSavedState = { flash: isEdit ? 'Changes saved.' : 'Member added.' }
      navigate(`${ROUTES.members}/${saved.memberId}`, { replace: true, state })
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiRequestError) {
        const fieldErrors = err.fieldErrors as MemberFormErrors
        if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors)
        if (err.code === 'MEMBER_PHONE_EXISTS') {
          const existingId = err.details?.memberId
          setFormError(
            <>
              {err.message}{' '}
              {typeof existingId === 'string' && MEMBER_ID_PATTERN.test(existingId) && (
                <Link to={`${ROUTES.members}/${existingId}`} className="font-medium underline">
                  View that member
                </Link>
              )}
            </>,
          )
          return
        }
      }
      setFormError(errorMessage(err))
    }
  }

  return (
    <>
      <PageHeader
        title={isEdit ? `Edit ${initial.fullName}` : 'Add member'}
        description={
          isEdit ? 'Update this member’s details.' : 'Register a new member at your gym.'
        }
        back={{ to: detailPath, label: isEdit ? 'Back to member' : 'Back to members' }}
      />

      <form noValidate onSubmit={handleSubmit} className="space-y-6">
        {formError && (
          <div ref={errorRef} tabIndex={-1} className="scroll-mt-24 outline-none">
            <Alert>{formError}</Alert>
          </div>
        )}

        <Section title="Personal details">
          <TextField
            label="Full name"
            required
            autoComplete="off"
            maxLength={120}
            value={values.fullName}
            onChange={(e) => set('fullName', e.target.value)}
            error={errors.fullName}
            className="sm:col-span-2"
          />
          <TextField
            label="Phone"
            required
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+91 98765 43210"
            value={values.phone}
            onChange={(e) => set('phone', e.target.value)}
            error={errors.phone}
            hint="Must be unique within your gym."
          />
          <TextField
            label="Email"
            type="email"
            autoComplete="off"
            maxLength={254}
            value={values.email}
            onChange={(e) => set('email', e.target.value)}
            error={errors.email}
          />
          <SelectField
            label="Gender"
            value={values.gender}
            onChange={(e) => set('gender', e.target.value as MemberFormValues['gender'])}
            error={errors.gender}
          >
            <option value="">Not specified</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </SelectField>
          <TextField
            label="Date of birth"
            type="date"
            max={todayIso()}
            value={values.dateOfBirth}
            onChange={(e) => set('dateOfBirth', e.target.value)}
            error={errors.dateOfBirth}
          />
        </Section>

        <Section title="Membership">
          <TextField
            label="Join date"
            type="date"
            required={isEdit}
            value={values.joinDate}
            onChange={(e) => set('joinDate', e.target.value)}
            error={errors.joinDate}
            hint={isEdit ? undefined : 'Defaults to today.'}
          />
          <SelectField
            label="Trainer"
            value={values.trainerId}
            onChange={(e) => set('trainerId', e.target.value)}
            error={errors.trainerId}
            hint={
              trainers.data && trainers.data.length === 0 ? 'No active trainers yet.' : undefined
            }
          >
            <option value="">No trainer</option>
            {(trainers.data ?? []).map((t) => (
              <option key={t.userId} value={t.userId}>
                {t.fullName}
              </option>
            ))}
            {/* Keep an assigned trainer selectable even if they are no longer listed. */}
            {values.trainerId &&
              trainers.data &&
              !trainers.data.some((t) => t.userId === values.trainerId) && (
                <option value={values.trainerId}>Current trainer (inactive)</option>
              )}
          </SelectField>
        </Section>

        <Section title="Address & emergency contact">
          <TextAreaField
            label="Address"
            maxLength={300}
            rows={2}
            value={values.address}
            onChange={(e) => set('address', e.target.value)}
            error={errors.address}
            className="sm:col-span-2"
          />
          <TextField
            label="Emergency contact name"
            maxLength={120}
            autoComplete="off"
            value={values.emergencyContactName}
            onChange={(e) => set('emergencyContactName', e.target.value)}
            error={errors.emergencyContactName}
          />
          <TextField
            label="Emergency contact phone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={values.emergencyContactPhone}
            onChange={(e) => set('emergencyContactPhone', e.target.value)}
            error={errors.emergencyContactPhone}
          />
        </Section>

        <Section title="Notes">
          <TextAreaField
            label="Notes"
            maxLength={1000}
            value={values.notes}
            onChange={(e) => set('notes', e.target.value)}
            error={errors.notes}
            hint="Health conditions, goals or anything staff should know."
            className="sm:col-span-2"
          />
        </Section>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <ButtonLink to={detailPath} variant="secondary">
            Cancel
          </ButtonLink>
          <Button type="submit" loading={saving} icon={<Save className="size-4" aria-hidden />}>
            {isEdit ? 'Save changes' : 'Add member'}
          </Button>
        </div>
      </form>
    </>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="p-5 sm:p-6">
      <h2 className="text-base">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </Card>
  )
}
