import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react'

import { cn } from '@/utils/cn'

const CONTROL =
  'block w-full rounded-control border bg-surface px-3 py-2 text-sm text-foreground shadow-card placeholder:text-subtle focus:outline-2 focus:outline-offset-0 focus:outline-brand-500 disabled:bg-surface-muted disabled:text-muted'

interface FieldShellProps {
  label: string
  error?: string | undefined
  hint?: string | undefined
  required?: boolean | undefined
  className?: string | undefined
  children: (ids: { id: string; describedBy: string | undefined }) => ReactNode
}

/** Label + control + hint/error, with the accessibility wiring done once. */
function FieldShell({ label, error, hint, required, className, children }: FieldShellProps) {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ')

  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-foreground">
        {label}
        {required && (
          <span className="ml-0.5 text-danger" aria-hidden>
            *
          </span>
        )}
      </label>
      {children({ id, describedBy: describedBy || undefined })}
      {error ? (
        <p id={errorId} className="mt-1.5 text-xs font-medium text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

type Common = {
  label: string
  error?: string | undefined
  hint?: string | undefined
  className?: string | undefined
}

export function TextField({
  label,
  error,
  hint,
  className,
  required,
  ...input
}: Common & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy }) => (
        <input
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, error ? 'border-danger' : 'border-border')}
          {...input}
        />
      )}
    </FieldShell>
  )
}

export function SelectField({
  label,
  error,
  hint,
  className,
  required,
  children,
  ...select
}: Common & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy }) => (
        <select
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, error ? 'border-danger' : 'border-border')}
          {...select}
        >
          {children}
        </select>
      )}
    </FieldShell>
  )
}

export function TextAreaField({
  label,
  error,
  hint,
  className,
  required,
  ...textarea
}: Common & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <FieldShell label={label} error={error} hint={hint} required={required} className={className}>
      {({ id, describedBy }) => (
        <textarea
          id={id}
          required={required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(CONTROL, 'min-h-24 resize-y', error ? 'border-danger' : 'border-border')}
          {...textarea}
        />
      )}
    </FieldShell>
  )
}
