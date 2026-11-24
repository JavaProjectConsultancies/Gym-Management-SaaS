import {
  Banknote,
  CreditCard,
  Landmark,
  MoreHorizontal,
  Smartphone,
  type LucideIcon,
} from 'lucide-react'

import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS } from '@/services/payments/paymentText'
import type { PaymentMethod } from '@/types/payment'
import { cn } from '@/utils/cn'

const ICONS: Record<PaymentMethod, LucideIcon> = {
  CASH: Banknote,
  UPI: Smartphone,
  CARD: CreditCard,
  BANK_TRANSFER: Landmark,
  OTHER: MoreHorizontal,
}

/** Big tappable chips for the payment method (radio group). */
export default function MethodPicker({
  value,
  onChange,
  error,
}: {
  value: PaymentMethod | null
  onChange: (m: PaymentMethod) => void
  error?: string | undefined
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">
        Paid by<span className="ml-0.5 text-danger">*</span>
      </legend>
      <div role="radiogroup" className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {PAYMENT_METHODS.map((m) => {
          const Icon = ICONS[m]
          const selected = value === m
          return (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(m)}
              className={cn(
                'flex flex-col items-center gap-1 rounded-card border px-2 py-2.5 text-xs font-medium transition-colors active:scale-95',
                selected
                  ? 'border-brand-500 bg-brand-50 text-brand-700 ring-1 ring-brand-500'
                  : 'border-border text-muted hover:bg-surface-muted',
              )}
            >
              <Icon className="size-5" aria-hidden />
              {PAYMENT_METHOD_LABELS[m]}
            </button>
          )
        })}
      </div>
      {error && <p className="mt-1.5 text-xs font-medium text-danger">{error}</p>}
    </fieldset>
  )
}
