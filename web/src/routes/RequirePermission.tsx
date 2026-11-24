import { ServerCrash, ShieldX } from 'lucide-react'
import type { ReactNode } from 'react'
import { Outlet } from 'react-router'

import { ButtonLink } from '@/components/ui/Button'
import Button from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'

import { ROUTES } from './paths'

/**
 * Shows child routes only when the backend session grants `permission`.
 * UI convenience only — the backend enforces the same permission on every call.
 */
export default function RequirePermission({ permission }: { permission: string }) {
  const { session, hasPermission } = useAuth()

  if (!session) {
    return (
      <Blocked
        icon={<ServerCrash className="size-6" aria-hidden />}
        title="Could not verify your access"
        body="The server could not be reached when you signed in. Check your connection and reload the page."
        action={<Button onClick={() => window.location.reload()}>Reload</Button>}
      />
    )
  }

  if (!hasPermission(permission)) {
    return (
      <Blocked
        icon={<ShieldX className="size-6" aria-hidden />}
        title="You don't have access to this page"
        body="Ask your gym owner or administrator if you need access."
        action={
          <ButtonLink to={ROUTES.home} variant="secondary">
            Back to home
          </ButtonLink>
        }
      />
    )
  }

  return <Outlet />
}

function Blocked({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode
  title: string
  body: string
  action: ReactNode
}) {
  return (
    <div className="grid place-items-center py-24 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-muted">
        {icon}
      </span>
      <h1 className="mt-4 text-xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted">{body}</p>
      <div className="mt-6">{action}</div>
    </div>
  )
}
