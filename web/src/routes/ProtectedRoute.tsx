import { Navigate, Outlet, useLocation } from 'react-router'

import FullPageLoader from '@/components/common/FullPageLoader'
import { useAuth } from '@/hooks/useAuth'

import { ROUTES } from './paths'

export interface LoginRedirectState {
  from?: string
}

/**
 * Renders child routes only for signed-in users; everyone else is sent to the
 * login page with the original URL so they can return after signing in.
 *
 * This guards the UI only. Data access is enforced by the backend.
 */
export default function ProtectedRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <FullPageLoader label="Checking your session…" />
  }

  if (status === 'unauthenticated') {
    const state: LoginRedirectState = {
      from: `${location.pathname}${location.search}${location.hash}`,
    }
    return <Navigate to={ROUTES.login} replace state={state} />
  }

  return <Outlet />
}
