import { X } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'

interface SheetProps {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  /** Prevent closing (Escape / backdrop) while saving. */
  busy?: boolean
  children: ReactNode
  /** Sticky action bar at the bottom (buttons). */
  footer?: ReactNode
}

/**
 * Bottom sheet on phones (slides up, like a native app), centred dialog on
 * larger screens. Built on <dialog>: focus trap, Escape to close, inert page.
 */
export default function Sheet({
  open,
  title,
  description,
  onClose,
  busy = false,
  children,
  footer,
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

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
      onCancel={(e) => {
        e.preventDefault()
        if (!busy) onClose()
      }}
      onClick={(e) => {
        // Click on the backdrop (the dialog element itself, outside the panel) closes it.
        if (e.target === e.currentTarget && !busy) onClose()
      }}
      className="m-0 mt-auto max-h-[92dvh] w-full max-w-none overflow-hidden rounded-t-2xl border-0 bg-surface p-0 text-foreground shadow-raised open:flex open:animate-sheet-up open:flex-col sm:m-auto sm:max-h-[85dvh] sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-card sm:open:animate-fade-in"
    >
      <div className="flex shrink-0 flex-col items-center pt-2 sm:hidden" aria-hidden>
        <span className="h-1 w-10 rounded-full bg-border" />
      </div>
      <header className="flex shrink-0 items-start gap-3 px-5 pt-3 pb-3 sm:px-6 sm:pt-5">
        <div className="min-w-0 flex-1">
          <h2 id={titleId} className="text-lg">
            {title}
          </h2>
          {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
        </div>
        <button
          type="button"
          onClick={onClose}
          disabled={busy}
          className="-mr-2 grid size-9 place-items-center rounded-full text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-50"
          aria-label="Close"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4 sm:px-6">
        {children}
      </div>
      {footer && (
        <footer className="flex shrink-0 gap-2 border-t border-border bg-surface-muted px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-6">
          {footer}
        </footer>
      )}
    </dialog>
  )
}
