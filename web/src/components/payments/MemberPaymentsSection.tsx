import { ChevronRight, Receipt } from 'lucide-react'
import { Link } from 'react-router'

import { Badge, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { formatDate } from '@/services/members/memberForm'
import { listMemberPayments, paymentCacheKeys } from '@/services/payments/paymentsApi'
import { PAYMENT_METHOD_LABELS } from '@/services/payments/paymentText'
import type { Payment } from '@/types/payment'
import { cn } from '@/utils/cn'
import { formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

/** Payment history on the member profile. `refreshKey` changes force a reload. */
export default function MemberPaymentsSection({
  gymId,
  memberId,
  refreshKey,
}: {
  gymId: string
  memberId: string
  refreshKey: number
}) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canRead = hasPermission(PERMISSIONS.paymentsRead)
  const { current, error, reload } = useAsyncData<Payment[]>(
    canRead ? `${paymentCacheKeys.member(gymId, memberId)}#${refreshKey}` : null,
    (signal) => listMemberPayments(api, gymId, memberId, signal),
  )
  if (!canRead) return null

  return (
    <Card className="p-4 sm:p-6">
      <h2 className="mb-4 flex items-center gap-2 text-base">
        <Receipt className="size-5 text-muted" aria-hidden />
        Payments
      </h2>
      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !current ? (
        <LoadingBlock label="Loading payments…" />
      ) : current.length === 0 ? (
        <p className="text-sm text-muted">No payments recorded yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-card border border-border">
          {current.map((p) => {
            const voided = p.status === 'VOIDED'
            return (
              <li key={p.paymentId}>
                <Link
                  to={`${ROUTES.payments}/${p.paymentId}`}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-surface-muted active:bg-surface-muted sm:px-4"
                >
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className={cn('font-medium tabular-nums', voided && 'line-through')}>
                        {formatMoney(p.amount)}
                      </span>
                      {voided && <Badge tone="danger">Voided</Badge>}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {p.receiptNo} · {PAYMENT_METHOD_LABELS[p.method]} ·{' '}
                      {formatDate(p.paymentDate)}
                      {p.membership && ` · ${p.membership.planName}`}
                    </p>
                  </div>
                  <ChevronRight className="size-5 shrink-0 text-subtle" aria-hidden />
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
