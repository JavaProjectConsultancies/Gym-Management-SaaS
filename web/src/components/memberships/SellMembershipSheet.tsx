import { Check, Settings2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'

import Button from '@/components/ui/Button'
import { Alert, LoadingBlock } from '@/components/ui/Feedback'
import { TextAreaField, TextField } from '@/components/ui/Field'
import MethodPicker from '@/components/payments/MethodPicker'
import { validateAmount } from '@/components/payments/paymentForm'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { ApiRequestError } from '@/services/api/apiClient'
import { addDaysIso, formatDate, isValidIsoDate } from '@/services/members/memberForm'
import { cacheKeys, listPlans, sellMembership } from '@/services/memberships/membershipsApi'
import type { Membership, Plan } from '@/types/membership'
import type { PaymentMethod } from '@/types/payment'
import { cn } from '@/utils/cn'
import { errorMessage } from '@/utils/errors'
import { formatDuration, formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

interface Props {
  open: boolean
  gymId: string
  memberId: string
  memberName: string
  suggestedStartDate: string
  isRenewal: boolean
  onClose: () => void
  onSold: (membership: Membership) => void
}

/** Sell a plan to a member (new membership or renewal). */
export default function SellMembershipSheet(props: Props) {
  // Remount the form each time the sheet opens, so it starts clean.
  return props.open ? <SellForm {...props} /> : null
}

function sheetProps(p: Props) {
  return {
    title: p.isRenewal ? 'Renew membership' : 'Add membership',
    description: p.memberName,
    onClose: p.onClose,
  }
}

function SellForm(props: Props) {
  const { gymId, memberId, suggestedStartDate, onClose, onSold } = props
  const api = useApi()
  const { hasPermission } = useAuth()
  const plans = useAsyncData<Plan[]>(cacheKeys.plans(gymId), (signal) =>
    listPlans(api, gymId, signal),
  )
  const activePlans = (plans.data ?? []).filter((p) => p.status === 'ACTIVE')

  const [planId, setPlanId] = useState<string | null>(null)
  const [startDate, setStartDate] = useState(suggestedStartDate)
  const [price, setPrice] = useState('')
  const [notes, setNotes] = useState('')
  // Phase 7: collect the first payment in the same step.
  const canCollect = hasPermission(PERMISSIONS.paymentsWrite)
  const [collectNow, setCollectNow] = useState(canCollect)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState<PaymentMethod | null>(null)
  const [payRef, setPayRef] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [suggested, setSuggested] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const plan = activePlans.find((p) => p.planId === planId) ?? null
  const endDate =
    plan && isValidIsoDate(startDate) ? addDaysIso(startDate, plan.durationDays - 1) : null

  function clearError(field: string) {
    setErrors((e) => {
      if (!(field in e)) return e
      const next = { ...e }
      delete next[field]
      return next
    })
  }

  function choosePlan(p: Plan) {
    setPlanId(p.planId)
    setPrice(String(p.price))
    setPayAmount(String(p.price))
    setErrors({})
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    if (!plan) found.planId = 'Choose a plan.'
    if (!isValidIsoDate(startDate)) found.startDate = 'Enter a valid date.'
    const amount = Number(price)
    if (price.trim() === '' || !Number.isFinite(amount) || amount < 0) {
      found.price = 'Enter an amount (0 or more).'
    } else if (Math.round(amount * 100) !== amount * 100) {
      found.price = 'Use at most 2 decimal places.'
    }
    if (collectNow && !found.price) {
      const payError = validateAmount(payAmount, amount)
      if (payError) found.paymentAmount = payError
      if (!payMethod) found.paymentMethod = 'Choose how they paid.'
    }
    setErrors(found)
    setFormError(null)
    setSuggested(null)
    if (Object.keys(found).length > 0 || !plan) return

    setSaving(true)
    try {
      const sold = await sellMembership(api, gymId, memberId, {
        planId: plan.planId,
        startDate,
        price: amount === plan.price ? undefined : amount,
        notes,
        ...(collectNow && payMethod
          ? { paymentAmount: Number(payAmount), paymentMethod: payMethod, paymentReference: payRef }
          : {}),
      })
      onSold(sold)
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiRequestError) {
        setErrors(err.fieldErrors)
        const s = err.details?.suggestedStartDate
        if (typeof s === 'string' && isValidIsoDate(s)) setSuggested(s)
      }
      setFormError(errorMessage(err))
    }
  }

  return (
    <Sheet
      {...sheetProps(props)}
      open
      busy={saving}
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
            form="sell-membership"
            loading={saving}
            disabled={!plan}
            className="flex-1 sm:flex-none"
          >
            {!plan
              ? 'Choose a plan'
              : collectNow
                ? `Confirm · collect ${formatMoney(Number(payAmount) || 0)}`
                : `Confirm · ${formatMoney(Number(price) || 0)}`}
          </Button>
        </>
      }
    >
      <form id="sell-membership" noValidate onSubmit={submit} className="space-y-5">
        {formError && (
          <Alert>
            {formError}
            {suggested && (
              <button
                type="button"
                className="ml-1 font-medium underline"
                onClick={() => {
                  setStartDate(suggested)
                  setSuggested(null)
                  setFormError(null)
                  setErrors({})
                }}
              >
                Start on {formatDate(suggested)} instead
              </button>
            )}
          </Alert>
        )}

        <fieldset>
          <legend className="mb-2 text-sm font-medium">Plan</legend>
          {plans.error ? (
            <Alert>{plans.error}</Alert>
          ) : !plans.data ? (
            <LoadingBlock label="Loading plans…" />
          ) : activePlans.length === 0 ? (
            <div className="rounded-card border border-dashed border-border p-4 text-center text-sm text-muted">
              No plans yet.{' '}
              {hasPermission(PERMISSIONS.plansWrite) ? (
                <Link to={ROUTES.plans} className="font-medium text-brand-700 underline">
                  Create a plan
                </Link>
              ) : (
                'Ask your gym owner to create one.'
              )}
            </div>
          ) : (
            <div role="radiogroup" className="grid gap-2">
              {activePlans.map((p) => {
                const selected = p.planId === planId
                return (
                  <button
                    key={p.planId}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => choosePlan(p)}
                    className={cn(
                      'flex items-center gap-3 rounded-card border p-3 text-left transition-colors active:scale-[0.99]',
                      selected
                        ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-500'
                        : 'border-border hover:bg-surface-muted',
                    )}
                  >
                    <span
                      className={cn(
                        'grid size-5 shrink-0 place-items-center rounded-full border',
                        selected ? 'border-brand-600 bg-brand-600 text-white' : 'border-subtle',
                      )}
                    >
                      {selected && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{p.name}</span>
                      <span className="block text-xs text-muted">
                        {formatDuration(p.durationDays)}
                      </span>
                    </span>
                    <span className="font-semibold tabular-nums">{formatMoney(p.price)}</span>
                  </button>
                )
              })}
            </div>
          )}
          {errors.planId && (
            <p className="mt-1.5 text-xs font-medium text-danger">{errors.planId}</p>
          )}
          {hasPermission(PERMISSIONS.plansWrite) && activePlans.length > 0 && (
            <Link
              to={ROUTES.plans}
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-muted hover:text-foreground"
            >
              <Settings2 className="size-3.5" aria-hidden />
              Manage plans
            </Link>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Start date"
            type="date"
            required
            value={startDate}
            onChange={(e) => {
              setStartDate(e.target.value)
              clearError('startDate')
            }}
            error={errors.startDate}
            hint={endDate ? `Ends ${formatDate(endDate)}` : undefined}
          />
          <TextField
            label="Price (₹)"
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            required
            value={price}
            onChange={(e) => {
              setPrice(e.target.value)
              clearError('price')
            }}
            error={errors.price}
            hint={
              plan && Number(price) !== plan.price
                ? `Plan price ${formatMoney(plan.price)}`
                : undefined
            }
          />
        </div>

        <TextAreaField
          label="Notes"
          rows={2}
          maxLength={500}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          error={errors.notes}
          hint="Optional, e.g. discount reason."
        />

        {canCollect && plan && (
          <section className="space-y-4 rounded-card border border-border p-4">
            <label className="flex items-center justify-between gap-3">
              <span>
                <span className="block text-sm font-medium">Collect payment now</span>
                <span className="block text-xs text-muted">
                  Turn off to record the sale and collect later (it shows under Dues).
                </span>
              </span>
              <input
                type="checkbox"
                checked={collectNow}
                onChange={(e) => setCollectNow(e.target.checked)}
                className="size-5 accent-brand-600"
              />
            </label>
            {collectNow && (
              <>
                <TextField
                  label="Amount received (₹)"
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  required
                  value={payAmount}
                  onChange={(e) => {
                    setPayAmount(e.target.value)
                    clearError('paymentAmount')
                  }}
                  error={errors.paymentAmount}
                  hint={
                    Number(payAmount) > 0 && Number(payAmount) < Number(price)
                      ? `Part payment — ${formatMoney(Math.round((Number(price) - Number(payAmount)) * 100) / 100)} will be due.`
                      : undefined
                  }
                />
                <MethodPicker
                  value={payMethod}
                  onChange={(m) => {
                    setPayMethod(m)
                    clearError('paymentMethod')
                  }}
                  error={errors.paymentMethod}
                />
                <TextField
                  label="Reference"
                  maxLength={100}
                  placeholder="UPI / card txn ID"
                  value={payRef}
                  onChange={(e) => setPayRef(e.target.value)}
                  hint="Optional."
                />
              </>
            )}
          </section>
        )}
      </form>
    </Sheet>
  )
}
