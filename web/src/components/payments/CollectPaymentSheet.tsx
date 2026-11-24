import { useState, type FormEvent } from 'react'

import Button from '@/components/ui/Button'
import { Alert } from '@/components/ui/Feedback'
import { TextField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { ApiRequestError } from '@/services/api/apiClient'
import { formatDate, isValidIsoDate, todayIso } from '@/services/members/memberForm'
import { recordPayment } from '@/services/payments/paymentsApi'
import type { Membership } from '@/types/membership'
import type { Payment, PaymentMethod } from '@/types/payment'
import { errorMessage } from '@/utils/errors'
import { formatMoney } from '@/utils/format'

import MethodPicker from './MethodPicker'
import { validateAmount } from './paymentForm'

interface Props {
  gymId: string
  /** The membership to collect for; null = closed. */
  membership: Membership | null
  memberName: string
  onClose: () => void
  onRecorded: (payment: Payment, membership: Membership) => void
}

/** Collect money against a membership (full or part payment). */
export default function CollectPaymentSheet(props: Props) {
  return props.membership ? (
    <CollectForm key={props.membership.membershipId} {...props} membership={props.membership} />
  ) : null
}

function CollectForm({
  gymId,
  membership,
  memberName,
  onClose,
  onRecorded,
}: Props & { membership: Membership }) {
  const api = useApi()
  const due = membership.balanceDue ?? membership.price
  const [amount, setAmount] = useState(String(due))
  const [method, setMethod] = useState<PaymentMethod | null>(null)
  const [date, setDate] = useState(todayIso())
  const [reference, setReference] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function clearError(field: string) {
    setErrors((prev) => {
      if (!(field in prev)) return prev
      const next = { ...prev }
      delete next[field]
      return next
    })
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const found: Record<string, string> = {}
    const amountError = validateAmount(amount, due)
    if (amountError) found.amount = amountError
    if (!method) found.method = 'Choose how they paid.'
    if (!isValidIsoDate(date) || date > todayIso()) found.paymentDate = 'Today or an earlier date.'
    setErrors(found)
    setFormError(null)
    if (Object.keys(found).length > 0 || !method) return

    setSaving(true)
    try {
      const res = await recordPayment(api, gymId, membership.membershipId, membership.memberId, {
        amount: Number(amount),
        method,
        paymentDate: date === todayIso() ? undefined : date,
        reference,
      })
      onRecorded(res.payment, res.membership)
    } catch (err) {
      setSaving(false)
      if (err instanceof ApiRequestError) setErrors(err.fieldErrors)
      setFormError(errorMessage(err))
    }
  }

  const value = Number(amount)
  const remaining = Number.isFinite(value)
    ? Math.max(0, Math.round((due - value) * 100) / 100)
    : due

  return (
    <Sheet
      open
      title="Collect payment"
      description={`${memberName} · ${membership.planName} (${formatDate(membership.startDate)} – ${formatDate(membership.endDate)})`}
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
            form="collect-payment"
            loading={saving}
            className="flex-1 sm:flex-none"
          >
            Record {Number.isFinite(value) && value > 0 ? formatMoney(value) : 'payment'}
          </Button>
        </>
      }
    >
      <form id="collect-payment" noValidate onSubmit={submit} className="space-y-5">
        {formError && <Alert>{formError}</Alert>}

        <div className="flex items-center justify-between rounded-card bg-surface-muted px-4 py-3 text-sm">
          <span className="text-muted">Balance due</span>
          <span className="text-lg font-semibold tabular-nums">{formatMoney(due)}</span>
        </div>

        <TextField
          label="Amount received (₹)"
          type="number"
          inputMode="decimal"
          min={0}
          step="0.01"
          required
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value)
            clearError('amount')
          }}
          error={errors.amount}
          hint={
            remaining > 0 && value > 0
              ? `Part payment — ${formatMoney(remaining)} will still be due.`
              : 'Pays the full balance.'
          }
        />

        <MethodPicker
          value={method}
          onChange={(m) => {
            setMethod(m)
            clearError('method')
          }}
          error={errors.method}
        />

        <div className="grid gap-4 sm:grid-cols-2">
          <TextField
            label="Payment date"
            type="date"
            max={todayIso()}
            required
            value={date}
            onChange={(e) => {
              setDate(e.target.value)
              clearError('paymentDate')
            }}
            error={errors.paymentDate}
          />
          <TextField
            label="Reference"
            maxLength={100}
            placeholder="UPI / card txn ID"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            error={errors.reference}
            hint="Optional."
          />
        </div>
      </form>
    </Sheet>
  )
}
