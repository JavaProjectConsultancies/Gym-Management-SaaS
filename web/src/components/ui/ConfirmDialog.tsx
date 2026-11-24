import { useEffect, useId, useRef } from 'react'

import Button from './Button'

interface ConfirmDialogProps {
  open: boolean
  title: string
  body: string
  confirmLabel: string
  tone?: 'primary' | 'danger'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

/**
 * In-app confirmation dialog built on the native <dialog> element (focus trap,
 * Escape to close, inert background). Never uses window.confirm.
 */
export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  tone = 'primary',
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const bodyId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-0 text-foreground shadow-raised backdrop:bg-slate-950/50 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <h2 id={titleId} className="text-lg">
          {title}
        </h2>
        <p id={bodyId} className="mt-2 text-sm text-muted">
          {body}
        </p>
      </div>
      <div className="flex justify-end gap-2 border-t border-border bg-surface-muted px-6 py-4">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant={tone === 'danger' ? 'danger' : 'primary'}
          onClick={onConfirm}
          loading={busy}
        >
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}
