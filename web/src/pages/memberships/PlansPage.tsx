import { Pencil, Plus, Tag } from 'lucide-react'
import { useState, type FormEvent } from 'react'

import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import Button from '@/components/ui/Button'
import { Alert, Badge, Card, EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { TextAreaField, TextField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ApiRequestError } from '@/services/api/apiClient'
import { cacheKeys, createPlan, listPlans, updatePlan } from '@/services/memberships/membershipsApi'
import type { Plan } from '@/types/membership'
import { cn } from '@/utils/cn'
import { errorMessage } from '@/utils/errors'
import { formatDuration, formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

const DURATION_PRESETS = [
  { label: '1 month', days: 30 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '1 year', days: 365 },
]

export default function PlansPage() {
  return <GymGate>{(gym) => <Plans gymId={gym.gymId} />}</GymGate>
}

function Plans({ gymId }: { gymId: string }) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canWrite = hasPermission(PERMISSIONS.plansWrite)
  const { data, error, reload, setData } = useAsyncData<Plan[]>(cacheKeys.plans(gymId), (signal) =>
    listPlans(api, gymId, signal),
  )
  // null = closed, 'new' = create, Plan = edit
  const [editing, setEditing] = useState<Plan | 'new' | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  function saved(plan: Plan, created: boolean) {
    const list = data ?? []
    setData(created ? [...list, plan] : list.map((p) => (p.planId === plan.planId ? plan : p)))
    setEditing(null)
    setFlash(created ? `Plan “${plan.name}” created.` : `Plan “${plan.name}” saved.`)
    reload()
  }

  return (
    <>
      <PageHeader
        title="Membership plans"
        description="What your gym sells. Price changes apply to new sales only."
        back={{ to: '/memberships', label: 'Memberships' }}
        fab={
          canWrite
            ? {
                label: 'New plan',
                icon: <Plus className="size-5" aria-hidden />,
                onClick: () => setEditing('new'),
              }
            : undefined
        }
      />

      {flash && (
        <div className="mb-4">
          <Alert tone="success">{flash}</Alert>
        </div>
      )}

      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingBlock label="Loading plans…" />
      ) : data.length === 0 ? (
        <Card>
          <EmptyBlock
            title="No plans yet"
            body="Create plans such as Monthly or Quarterly, then sell them to members."
            action={
              canWrite && (
                <Button size="sm" onClick={() => setEditing('new')}>
                  Create first plan
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((p) => (
            <li key={p.planId}>
              <Card
                className={cn(
                  'flex h-full flex-col p-4 sm:p-5',
                  p.status === 'INACTIVE' && 'opacity-70',
                )}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{p.name}</p>
                    <p className="text-sm text-muted">{formatDuration(p.durationDays)}</p>
                  </div>
                  {p.status === 'INACTIVE' ? (
                    <Badge>Inactive</Badge>
                  ) : (
                    <span className="grid size-9 place-items-center rounded-full bg-brand-50 text-brand-600">
                      <Tag className="size-4" aria-hidden />
                    </span>
                  )}
                </div>
                <p className="mt-3 text-2xl font-semibold tabular-nums">{formatMoney(p.price)}</p>
                {p.description && (
                  <p className="mt-1 line-clamp-2 text-sm text-muted">{p.description}</p>
                )}
                {canWrite && (
                  <div className="mt-auto pt-4">
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setEditing(p)}
                      icon={<Pencil className="size-4" aria-hidden />}
                    >
                      Edit
                    </Button>
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {editing !== null && (
        <PlanSheet
          gymId={gymId}
          plan={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={saved}
        />
      )}
    </>
  )
}

function PlanSheet({
  gymId,
  plan,
  onClose,
  onSaved,
}: {
  gymId: string
  plan: Plan | null
  onClose: () => void
  onSaved: (plan: Plan, created: boolean) => void
}) {
  const api = useApi()
  const [name, setName] = useState(plan?.name ?? '')
  const [days, setDays] = useState(plan ? String(plan.durationDays) : '30')
  const [price, setPrice] = useState(plan ? String(plan.price) : '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [active, setActive] = useState(plan ? plan.status === 'ACTIVE' : true)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    const n = name.trim()
    const d = Number(days)
    const pr = Number(price)
    if (n.length < 2) found.name = 'Enter at least 2 characters.'
    if (!Number.isInteger(d) || d < 1 || d > 3650) found.durationDays = 'Enter 1–3650 days.'
    if (price.trim() === '' || !Number.isFinite(pr) || pr < 0) found.price = 'Enter 0 or more.'
    else if (Math.round(pr * 100) !== pr * 100) found.price = 'Use at most 2 decimal places.'
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0) return

    setSaving(true)
    try {
      if (plan) {
        const patch: Record<string, unknown> = {}
        if (n !== plan.name) patch.name = n
        if (d !== plan.durationDays) patch.durationDays = d
        if (pr !== plan.price) patch.price = pr
        if (description.trim() !== (plan.description ?? '')) patch.description = description.trim()
        const status = active ? 'ACTIVE' : 'INACTIVE'
        if (status !== plan.status) patch.status = status
        if (Object.keys(patch).length === 0) {
          onClose()
          return
        }
        onSaved(await updatePlan(api, gymId, plan.planId, patch), false)
      } else {
        onSaved(
          await createPlan(api, gymId, { name: n, durationDays: d, price: pr, description }),
          true,
        )
      }
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors)
      setFormError(errorMessage(err))
    }
  }

  return (
    <Sheet
      open
      title={plan ? 'Edit plan' : 'New plan'}
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
          <Button type="submit" form="plan-form" loading={saving} className="flex-1 sm:flex-none">
            {plan ? 'Save' : 'Create plan'}
          </Button>
        </>
      }
    >
      <form id="plan-form" noValidate onSubmit={submit} className="space-y-4">
        {formError && <Alert>{formError}</Alert>}
        <TextField
          label="Plan name"
          required
          maxLength={80}
          placeholder="Monthly"
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={errors.name}
        />
        <div>
          <TextField
            label="Duration (days)"
            type="number"
            inputMode="numeric"
            required
            min={1}
            max={3650}
            value={days}
            onChange={(e) => setDays(e.target.value)}
            error={errors.durationDays}
            hint={Number(days) > 0 ? formatDuration(Number(days)) : undefined}
          />
          <div className="mt-2 flex flex-wrap gap-2">
            {DURATION_PRESETS.map((p) => (
              <button
                key={p.days}
                type="button"
                onClick={() => setDays(String(p.days))}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium active:scale-95',
                  Number(days) === p.days
                    ? 'border-brand-500 bg-brand-50 text-brand-700'
                    : 'border-border text-muted hover:bg-surface-muted',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
        <TextField
          label="Price (₹)"
          type="number"
          inputMode="decimal"
          required
          min={0}
          step="0.01"
          placeholder="1500"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          error={errors.price}
        />
        <TextAreaField
          label="Description"
          rows={2}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          error={errors.description}
          hint="Optional, e.g. what's included."
        />
        {plan && (
          <label className="flex items-center justify-between gap-3 rounded-card border border-border p-3">
            <span>
              <span className="block text-sm font-medium">Offered for sale</span>
              <span className="block text-xs text-muted">
                Turn off to stop selling it. Existing memberships are unaffected.
              </span>
            </span>
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="size-5 accent-brand-600"
            />
          </label>
        )}
      </form>
    </Sheet>
  )
}
