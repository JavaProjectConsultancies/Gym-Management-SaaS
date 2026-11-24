import { Ban, MessageCircle, Printer, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { useParams } from 'react-router'

import BrandMark from '@/components/common/BrandMark'
import GymGate from '@/components/common/GymGate'
import PageHeader from '@/components/common/PageHeader'
import Button from '@/components/ui/Button'
import { Alert, Badge, Card, ErrorBlock, LoadingBlock } from '@/components/ui/Feedback'
import { TextAreaField } from '@/components/ui/Field'
import Sheet from '@/components/ui/Sheet'
import { useApi } from '@/hooks/useApi'
import { useAsyncData } from '@/hooks/useAsyncData'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import { formatDate } from '@/services/members/memberForm'
import {
  getPayment,
  PAYMENT_ID_PATTERN,
  paymentCacheKeys,
  voidPayment,
} from '@/services/payments/paymentsApi'
import { PAYMENT_METHOD_LABELS, receiptText, whatsappLink } from '@/services/payments/paymentText'
import type { Payment } from '@/types/payment'
import { cn } from '@/utils/cn'
import { errorMessage } from '@/utils/errors'
import { formatMoney } from '@/utils/format'
import { PERMISSIONS } from '@/utils/permissions'

export default function ReceiptPage() {
  const { paymentId = '' } = useParams()
  return <GymGate>{(gym) => <Receipt gymId={gym.gymId} paymentId={paymentId} />}</GymGate>
}

function Receipt({ gymId, paymentId }: { gymId: string; paymentId: string }) {
  const api = useApi()
  const { hasPermission } = useAuth()
  const validId = PAYMENT_ID_PATTERN.test(paymentId)
  const {
    current: payment,
    error,
    reload,
    setData,
  } = useAsyncData<Payment>(validId ? paymentCacheKeys.receipt(gymId, paymentId) : null, (signal) =>
    getPayment(api, gymId, paymentId, signal),
  )
  const [voiding, setVoiding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  if (!validId) return <ErrorBlock message="This receipt link is not valid." />
  if (error) return <ErrorBlock message={error} onRetry={reload} />
  if (!payment) return <LoadingBlock label="Loading receipt…" />

  const voided = payment.status === 'VOIDED'
  const text = receiptText(payment)
  const canShare = typeof navigator !== 'undefined' && 'share' in navigator

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={`Receipt ${payment.receiptNo}`}
          back={{ to: ROUTES.payments, label: 'Payments' }}
          actions={
            <>
              <Button
                variant="secondary"
                onClick={() => window.print()}
                icon={<Printer className="size-4" aria-hidden />}
              >
                Print
              </Button>
              {!voided && (
                <a
                  href={whatsappLink(payment.member?.phone, text)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-control bg-[#25D366] px-4 py-2 text-sm font-medium text-white shadow-card active:scale-95"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  WhatsApp
                </a>
              )}
              {canShare && (
                <Button
                  variant="secondary"
                  onClick={() => {
                    navigator.share({ title: `Receipt ${payment.receiptNo}`, text }).catch(() => {
                      // user dismissed the share sheet
                    })
                  }}
                  icon={<Share2 className="size-4" aria-hidden />}
                >
                  Share
                </Button>
              )}
            </>
          }
        />
        {message && (
          <div className="mb-4">
            <Alert tone="success">{message}</Alert>
          </div>
        )}
      </div>

      <Card
        className={cn(
          'mx-auto max-w-md overflow-hidden print:max-w-none print:border-0 print:shadow-none',
          voided && 'opacity-80',
        )}
      >
        <div className="flex items-center justify-between gap-3 bg-sidebar px-5 py-4 text-white print:bg-white print:text-black">
          <div className="print:hidden">
            <BrandMark withName={false} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{payment.gymName}</p>
            <p className="text-xs text-sidebar-muted print:text-black">Payment receipt</p>
          </div>
          <p className="font-mono text-sm">{payment.receiptNo}</p>
        </div>

        <div className="space-y-4 p-5">
          {voided && (
            <Alert title="This payment was voided">
              {payment.voidReason ?? 'No reason given.'}
            </Alert>
          )}
          <div className="text-center">
            <p className={cn('text-3xl font-semibold tabular-nums', voided && 'line-through')}>
              {formatMoney(payment.amount)}
            </p>
            <p className="mt-1 text-sm text-muted">
              {PAYMENT_METHOD_LABELS[payment.method]} · {formatDate(payment.paymentDate)}
            </p>
          </div>

          <dl className="divide-y divide-border rounded-card border border-border text-sm">
            <Row label="Member" value={payment.member?.fullName} />
            <Row label="Phone" value={payment.member?.phone} />
            {payment.membership && (
              <>
                <Row label="Plan" value={payment.membership.planName} />
                <Row
                  label="Period"
                  value={`${formatDate(payment.membership.startDate)} – ${formatDate(payment.membership.endDate)}`}
                />
                <Row label="Plan price" value={formatMoney(payment.membership.price)} />
                {payment.membership.balanceDue !== undefined && (
                  <Row
                    label="Balance due"
                    value={
                      payment.membership.balanceDue > 0 ? (
                        <span className="font-semibold text-amber-700">
                          {formatMoney(payment.membership.balanceDue)}
                        </span>
                      ) : (
                        <Badge tone="success">Fully paid</Badge>
                      )
                    }
                  />
                )}
              </>
            )}
            {payment.reference && <Row label="Reference" value={payment.reference} />}
          </dl>
          <p className="text-center text-xs text-subtle">
            Recorded {new Date(payment.createdAt).toLocaleString()}
          </p>
        </div>
      </Card>

      {!voided && hasPermission(PERMISSIONS.paymentsVoid) && (
        <div className="mt-6 text-center print:hidden">
          <Button
            variant="ghost"
            onClick={() => setVoiding(true)}
            icon={<Ban className="size-4" aria-hidden />}
            className="text-danger hover:text-danger"
          >
            Void this payment
          </Button>
        </div>
      )}

      <VoidSheet
        gymId={gymId}
        payment={voiding ? payment : null}
        onClose={() => setVoiding(false)}
        onVoided={(p) => {
          setVoiding(false)
          setData({ ...payment, ...p })
          reload() // fetch the updated balance due
          setMessage(`Payment ${p.receiptNo} voided. The amount is due again.`)
        }}
      />
    </>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium">{value ?? '—'}</dd>
    </div>
  )
}

function VoidSheet({
  gymId,
  payment,
  onClose,
  onVoided,
}: {
  gymId: string
  payment: Payment | null
  onClose: () => void
  onVoided: (p: Payment) => void
}) {
  const api = useApi()
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function confirm() {
    if (!payment) return
    if (reason.trim().length < 3) {
      setError('Please give a reason (at least 3 characters).')
      return
    }
    setBusy(true)
    setError(null)
    try {
      onVoided(await voidPayment(api, gymId, payment, reason))
      setReason('')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={payment !== null}
      title="Void this payment?"
      description={payment ? `${payment.receiptNo} · ${formatMoney(payment.amount)}` : undefined}
      busy={busy}
      onClose={onClose}
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
            Void payment
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert>{error}</Alert>}
        <p className="text-sm text-muted">
          Use this for mistakes (wrong amount or member). The receipt stays in the records as voided
          and the amount becomes due again. Record the correct payment afterwards.
        </p>
        <TextAreaField
          label="Reason"
          required
          rows={2}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>
    </Sheet>
  )
}
