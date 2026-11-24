import { HandCoins, IdCard, Plus, RefreshCw, XCircle } from 'lucide-react'
import { useState } from 'react'

import Button from '@/components/ui/Button'
import { Alert, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { TextAreaField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { formatDate } from '@/services/members/memberForm'
import {
  cacheKeys,
  cancelMembership,
  getMemberMemberships,
} from '@/services/memberships/membershipsApi'
import { daysLeftText } from '@/services/memberships/membershipText'
import type { MemberMemberships, Membership } from '@/types/membership'
import { errorMessage } from '@/utils/errors'
import { formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

import CollectPaymentSheet from '@/components/payments/CollectPaymentSheet'
import type { Payment } from '@/types/payment'

import { CurrentMembershipCard, MembershipStateBadge } from './MembershipBits'
import SellMembershipSheet from './SellMembershipSheet'

interface Props {
  gymId: string
  memberId: string
  memberName: string
  memberActive: boolean
  onMessage: (message: string) => void
  /** Called after a payment or a sale with payment, e.g. to refresh payment history. */
  onPaymentRecorded?: (payment: Payment) => void
}

/** Memberships block on the member profile: current, upcoming, history, sell, cancel. */
export default function MemberMembershipsSection({
  gymId,
  memberId,
  memberName,
  memberActive,
  onMessage,
  onPaymentRecorded,
}: Props) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const canRead = hasPermission(PERMISSIONS.membershipsRead)
  const canSell = hasPermission(PERMISSIONS.membershipsWrite)
  const canCollect = hasPermission(PERMISSIONS.paymentsWrite)

  const {
    current: data,
    error,
    reload,
  } = useAsyncData<MemberMemberships>(
    canRead ? cacheKeys.memberMemberships(gymId, memberId) : null,
    (signal) => getMemberMemberships(api, gymId, memberId, signal),
  )
  const [sellOpen, setSellOpen] = useState(false)
  const [cancelling, setCancelling] = useState<Membership | null>(null)
  const [collecting, setCollecting] = useState<Membership | null>(null)

  if (!canRead) return null

  const isRenewal = Boolean(data?.current || data?.next)
  const history = data?.memberships ?? []

  return (
    <Card className="p-4 sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-base">
          <IdCard className="size-5 text-muted" aria-hidden />
          Memberships
        </h2>
        {canSell && memberActive && data && (
          <Button
            size="sm"
            onClick={() => setSellOpen(true)}
            icon={
              isRenewal ? (
                <RefreshCw className="size-4" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )
            }
          >
            {isRenewal ? 'Renew' : 'Add membership'}
          </Button>
        )}
      </div>

      {error ? (
        <ErrorBlock message={error} onRetry={reload} />
      ) : !data ? (
        <LoadingBlock label="Loading memberships…" />
      ) : (
        <div className="space-y-4">
          {data.current ? (
            <CurrentMembershipCard membership={data.current} />
          ) : (
            <Alert tone="warning" title="No active membership">
              {history.some((m) => m.state === 'EXPIRED')
                ? 'Their last membership has ended.'
                : history.length > 0
                  ? 'Nothing is running or upcoming.'
                  : 'This member has not bought a membership yet.'}
              {!memberActive && ' Reactivate the member to add one.'}
            </Alert>
          )}

          {history.length > 0 && (
            <ul className="divide-y divide-border rounded-card border border-border">
              {history.map((m) => (
                <li key={m.membershipId} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium">{m.planName}</span>
                      <MembershipStateBadge state={m.state} />
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {formatDate(m.startDate)} – {formatDate(m.endDate)} · {formatMoney(m.price)}
                      {m.state !== 'EXPIRED' && m.state !== 'CANCELLED' && ` · ${daysLeftText(m)}`}
                    </p>
                    {m.cancelReason && (
                      <p className="mt-0.5 text-xs text-muted">Reason: {m.cancelReason}</p>
                    )}
                    {m.status !== 'CANCELLED' && m.balanceDue !== undefined && (
                      <p className="mt-1 text-xs">
                        {m.balanceDue > 0 ? (
                          <span className="font-medium text-amber-700">
                            {formatMoney(m.balanceDue)} due
                            {(m.amountPaid ?? 0) > 0 && (
                              <span className="font-normal text-muted">
                                {' '}
                                · {formatMoney(m.amountPaid ?? 0)} paid
                              </span>
                            )}
                          </span>
                        ) : (
                          <span className="font-medium text-brand-700">Paid in full</span>
                        )}
                      </p>
                    )}
                  </div>
                  {canCollect && m.status !== 'CANCELLED' && (m.balanceDue ?? 0) > 0 && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCollecting(m)}
                      icon={<HandCoins className="size-4" aria-hidden />}
                    >
                      Collect
                    </Button>
                  )}
                  {canSell && m.state !== 'CANCELLED' && m.state !== 'EXPIRED' && (
                    <button
                      type="button"
                      onClick={() => setCancelling(m)}
                      className="grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-red-50 hover:text-danger active:bg-red-100"
                      aria-label={`Cancel ${m.planName}`}
                    >
                      <XCircle className="size-5" aria-hidden />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {data && (
        <SellMembershipSheet
          open={sellOpen}
          gymId={gymId}
          memberId={memberId}
          memberName={memberName}
          suggestedStartDate={data.suggestedStartDate}
          isRenewal={isRenewal}
          onClose={() => setSellOpen(false)}
          onSold={(m) => {
            setSellOpen(false)
            reload()
            const when =
              m.state === 'UPCOMING'
                ? `Starts ${formatDate(m.startDate)}.`
                : `Valid until ${formatDate(m.endDate)}.`
            const paid = m.payment
              ? ` ${formatMoney(m.payment.amount)} received · receipt ${m.payment.receiptNo}.`
              : ''
            if (m.payment) onPaymentRecorded?.(m.payment)
            onMessage(`${m.planName} added. ${when}${paid}`)
          }}
        />
      )}

      <CollectPaymentSheet
        gymId={gymId}
        membership={collecting}
        memberName={memberName}
        onClose={() => setCollecting(null)}
        onRecorded={(payment) => {
          setCollecting(null)
          reload()
          onPaymentRecorded?.(payment)
          onMessage(`${formatMoney(payment.amount)} received · receipt ${payment.receiptNo}.`)
        }}
      />

      <CancelMembershipSheet
        gymId={gymId}
        membership={cancelling}
        onClose={() => setCancelling(null)}
        onCancelled={(m) => {
          setCancelling(null)
          reload()
          onMessage(`${m.planName} cancelled.`)
        }}
      />
    </Card>
  )
}

function CancelMembershipSheet({
  gymId,
  membership,
  onClose,
  onCancelled,
}: {
  gymId: string
  membership: Membership | null
  onClose: () => void
  onCancelled: (m: Membership) => void
}) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!membership) return
    setBusy(true)
    setError(null)
    try {
      const updated = await cancelMembership(api, gymId, membership, reason)
      setReason('')
      onCancelled(updated)
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={membership !== null}
      title="Cancel membership?"
      description={
        membership
          ? `${membership.planName}, ${formatDate(membership.startDate)} – ${formatDate(membership.endDate)}`
          : undefined
      }
      busy={busy}
      onClose={() => {
        setError(null)
        onClose()
      }}
      footer={
        <>
          <Button
            variant="secondary"
            onClick={onClose}
            disabled={busy}
            className="flex-1 sm:flex-none"
          >
            Keep it
          </Button>
          <Button
            variant="danger"
            onClick={() => void confirm()}
            loading={busy}
            className="flex-1 sm:flex-none"
          >
            Cancel membership
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-muted">
          The membership stays in the history as cancelled. Refunds are handled separately.
        </p>
        <TextAreaField
          label="Reason"
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          hint="Optional."
        />
      </div>
    </Sheet>
  )
}
