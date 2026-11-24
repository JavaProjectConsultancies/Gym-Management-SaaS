import {
  AlertCircle,
  CalendarCheck,
  Dumbbell,
  Eye,
  EyeOff,
  Loader2,
  Lock,
  Mail,
  ShieldCheck,
  Users,
} from 'lucide-react'
import { useId, useState, type FormEvent } from 'react'
import { Navigate, useLocation } from 'react-router'

import FullPageLoader from '@/components/common/FullPageLoader'
import { useAuth } from '@/hooks/useAuth'
import { ROUTES } from '@/routes/paths'
import type { LoginRedirectState } from '@/routes/ProtectedRoute'
import type { AuthError } from '@/types/auth'
import { cn } from '@/utils/cn'
import { APP_NAME } from '@/utils/constants'

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const HIGHLIGHTS = [
  { icon: Users, text: 'Members, memberships and renewals in one place' },
  { icon: CalendarCheck, text: 'Attendance, trainers and schedules at a glance' },
  { icon: ShieldCheck, text: 'Secure, per-gym access for your whole team' },
]

interface FieldErrors {
  email?: string
  password?: string
}

function validate(email: string, password: string): FieldErrors {
  const errors: FieldErrors = {}
  if (!email.trim()) errors.email = 'Email is required.'
  else if (!EMAIL_PATTERN.test(email.trim())) errors.email = 'Enter a valid email address.'
  if (!password) errors.password = 'Password is required.'
  return errors
}

/** Only allow in-app relative redirects (prevents open-redirect via router state). */
function safeRedirect(from: unknown): string {
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : ROUTES.home
}

export default function LoginPage() {
  const { status, isConfigured, signIn, sessionError, clearSessionError } = useAuth()
  const location = useLocation()
  const redirectTo = safeRedirect((location.state as LoginRedirectState | null)?.from)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [formError, setFormError] = useState<AuthError | null>(null)

  const emailId = useId()
  const passwordId = useId()
  const rememberId = useId()

  if (status === 'loading') {
    return <FullPageLoader label="Checking your session…" />
  }

  if (status === 'authenticated') {
    return <Navigate to={redirectTo} replace />
  }

  const error = formError ?? sessionError
  const disabled = submitting || !isConfigured

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return

    const errors = validate(email, password)
    setFieldErrors(errors)
    setFormError(null)
    clearSessionError()
    if (errors.email || errors.password) return

    setSubmitting(true)
    try {
      await signIn({ email, password, remember })
      // Redirect happens on re-render once the auth listener reports the user.
    } catch (err) {
      setFormError(err as AuthError)
      setPassword('')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid min-h-dvh bg-canvas lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Brand panel — desktop only */}
      <aside className="relative hidden overflow-hidden bg-sidebar lg:flex lg:flex-col lg:justify-between lg:p-12 xl:p-16">
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 -left-40 size-[28rem] rounded-full bg-brand-500/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -right-32 -bottom-48 size-[26rem] rounded-full bg-accent-500/10 blur-3xl"
        />

        <div className="relative flex items-center gap-3">
          <span className="grid size-11 place-items-center rounded-control bg-brand-500 text-white shadow-raised">
            <Dumbbell className="size-6" strokeWidth={2.25} aria-hidden />
          </span>
          <span className="text-lg font-semibold text-sidebar-foreground">{APP_NAME}</span>
        </div>

        <div className="relative max-w-md">
          <h2 className="text-4xl leading-tight font-semibold text-white xl:text-5xl">
            Run your gym like a <span className="text-brand-400">high-performance</span> business.
          </h2>
          <ul className="mt-10 space-y-4">
            {HIGHLIGHTS.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3 text-sidebar-foreground/90">
                <span className="grid size-9 shrink-0 place-items-center rounded-control bg-sidebar-elevated text-brand-400 ring-1 ring-sidebar-border">
                  <Icon className="size-[18px]" aria-hidden />
                </span>
                <span className="text-sm">{text}</span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative text-xs text-sidebar-muted">
          © {new Date().getFullYear()} {APP_NAME}
        </p>
      </aside>

      {/* Form panel */}
      <main className="flex items-center justify-center px-4 py-10 sm:px-6">
        <div className="w-full max-w-sm">
          {/* Mobile brand */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="grid size-10 place-items-center rounded-control bg-brand-500 text-white shadow-raised">
              <Dumbbell className="size-5" strokeWidth={2.25} aria-hidden />
            </span>
            <span className="font-semibold text-foreground">{APP_NAME}</span>
          </div>

          <h1 className="text-2xl sm:text-3xl">Welcome back</h1>
          <p className="mt-2 text-sm text-muted">Sign in to manage your gym.</p>

          {!isConfigured && (
            <div
              role="alert"
              className="mt-6 flex gap-3 rounded-control border border-warning/30 bg-warning/10 p-3 text-sm text-warning"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>
                Authentication is not configured. Add the Firebase settings to{' '}
                <code className="font-mono text-xs">web/.env.local</code> — see{' '}
                <code className="font-mono text-xs">docs/AUTHENTICATION.md</code>.
              </p>
            </div>
          )}

          {error && (
            <div
              role="alert"
              className="mt-6 flex gap-3 rounded-control border border-danger/25 bg-danger/5 p-3 text-sm text-danger"
            >
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <p>{error.message}</p>
            </div>
          )}

          <form noValidate onSubmit={handleSubmit} className="mt-6 space-y-5">
            <div>
              <label htmlFor={emailId} className="block text-sm font-medium text-foreground">
                Email
              </label>
              <div className="relative mt-1.5">
                <Mail
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  id={emailId}
                  type="email"
                  name="email"
                  autoComplete="email"
                  inputMode="email"
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={disabled}
                  aria-invalid={Boolean(fieldErrors.email)}
                  aria-describedby={fieldErrors.email ? `${emailId}-error` : undefined}
                  placeholder="you@yourgym.com"
                  className={cn(
                    'block h-11 w-full rounded-control border bg-surface pr-3 pl-10 text-sm text-foreground shadow-card transition',
                    'placeholder:text-subtle focus:ring-4 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                    fieldErrors.email
                      ? 'border-danger focus:border-danger focus:ring-danger/15'
                      : 'border-border focus:border-brand-500 focus:ring-brand-500/15',
                  )}
                />
              </div>
              {fieldErrors.email && (
                <p id={`${emailId}-error`} className="mt-1.5 text-xs text-danger">
                  {fieldErrors.email}
                </p>
              )}
            </div>

            <div>
              <label htmlFor={passwordId} className="block text-sm font-medium text-foreground">
                Password
              </label>
              <div className="relative mt-1.5">
                <Lock
                  className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle"
                  aria-hidden
                />
                <input
                  id={passwordId}
                  type={showPassword ? 'text' : 'password'}
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={disabled}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? `${passwordId}-error` : undefined}
                  placeholder="Enter your password"
                  className={cn(
                    'block h-11 w-full rounded-control border bg-surface pr-11 pl-10 text-sm text-foreground shadow-card transition',
                    'placeholder:text-subtle focus:ring-4 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                    fieldErrors.password
                      ? 'border-danger focus:border-danger focus:ring-danger/15'
                      : 'border-border focus:border-brand-500 focus:ring-brand-500/15',
                  )}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  disabled={disabled}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  className="absolute top-1/2 right-1.5 grid size-8 -translate-y-1/2 place-items-center rounded-control text-subtle hover:bg-surface-muted hover:text-foreground disabled:pointer-events-none"
                >
                  {showPassword ? (
                    <EyeOff className="size-4" aria-hidden />
                  ) : (
                    <Eye className="size-4" aria-hidden />
                  )}
                </button>
              </div>
              {fieldErrors.password && (
                <p id={`${passwordId}-error`} className="mt-1.5 text-xs text-danger">
                  {fieldErrors.password}
                </p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                id={rememberId}
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
                disabled={disabled}
                className="size-4 rounded border-border accent-brand-600"
              />
              <label htmlFor={rememberId} className="text-sm text-muted">
                Keep me signed in
              </label>
            </div>

            <button
              type="submit"
              disabled={disabled}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-control bg-brand-600 text-sm font-semibold text-white shadow-card transition hover:bg-brand-700 focus-visible:ring-4 focus-visible:ring-brand-500/25 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-8 text-center text-xs text-muted">
            Accounts are created by your gym administrator. Contact them if you need access.
          </p>
        </div>
      </main>
    </div>
  )
}
