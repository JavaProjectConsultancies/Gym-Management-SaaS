import { AlertCircle, CheckCircle2, Inbox, Loader2, RefreshCw } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/utils/cn'

import Button from './Button'

type Tone = 'success' | 'neutral' | 'warning' | 'danger'

const BADGE_TONES: Record<Tone, string> = {
  success: 'bg-brand-50 text-brand-700 ring-brand-200',
  neutral: 'bg-slate-100 text-slate-600 ring-slate-200',
  warning: 'bg-amber-50 text-amber-700 ring-amber-200',
  danger: 'bg-red-50 text-red-700 ring-red-200',
}

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
      )}
    >
      {children}
    </span>
  )
}

export function Alert({
  tone = 'danger',
  title,
  children,
}: {
  tone?: 'danger' | 'success' | 'warning'
  title?: string
  children?: ReactNode
}) {
  const Icon = tone === 'success' ? CheckCircle2 : AlertCircle
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={cn(
        'flex gap-3 rounded-control border px-4 py-3 text-sm',
        tone === 'danger' && 'border-red-200 bg-red-50 text-red-800',
        tone === 'success' && 'border-brand-200 bg-brand-50 text-brand-800',
        tone === 'warning' && 'border-amber-200 bg-amber-50 text-amber-800',
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5')}>{children}</div>}
      </div>
    </div>
  )
}

export function LoadingBlock({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
      <Loader2 className="size-5 animate-spin text-brand-600" aria-hidden />
      {label}
    </div>
  )
}

export function ErrorBlock({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-red-50 text-danger">
        <AlertCircle className="size-5" aria-hidden />
      </span>
      <p className="max-w-md text-sm text-muted">{message}</p>
      {onRetry && (
        <Button
          variant="secondary"
          size="sm"
          onClick={onRetry}
          icon={<RefreshCw className="size-4" />}
        >
          Try again
        </Button>
      )}
    </div>
  )
}

export function EmptyBlock({
  title,
  body,
  action,
}: {
  title: string
  body?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-14 text-center">
      <span className="grid size-11 place-items-center rounded-full bg-surface-muted text-subtle">
        <Inbox className="size-5" aria-hidden />
      </span>
      <p className="mt-1 font-medium text-foreground">{title}</p>
      {body && <p className="max-w-sm text-sm text-muted">{body}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <section className={cn('rounded-card border border-border bg-surface shadow-card', className)}>
      {children}
    </section>
  )
}
