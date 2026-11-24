import { createBrowserRouter } from 'react-router'

import AppLayout from '@/layouts/AppLayout'
import LoginPage from '@/pages/auth/LoginPage'
import MemberDetailPage from '@/pages/members/MemberDetailPage'
import MemberFormPage from '@/pages/members/MemberFormPage'
import MembersPage from '@/pages/members/MembersPage'
import MembershipsPage from '@/pages/memberships/MembershipsPage'
import PlansPage from '@/pages/memberships/PlansPage'
import PaymentsPage, { DuesPage } from '@/pages/payments/PaymentsPage'
import ReceiptPage from '@/pages/payments/ReceiptPage'
import AttendancePage from '@/pages/attendance/AttendancePage'
import TeamPage from '@/pages/staff/TeamPage'
import NotFoundPage from '@/pages/NotFoundPage'
import WelcomePage from '@/pages/WelcomePage'
import { PERMISSIONS } from '@/utils/permissions'

import { ROUTES } from './paths'
import ProtectedRoute from './ProtectedRoute'
import RequirePermission from './RequirePermission'
import type { RouteMeta } from './routeMeta'

/** `handle` feeds the mobile app bar: screen title and where "back" goes. */
const meta = (m: RouteMeta) => m

export const router = createBrowserRouter([
  // Public routes
  { path: ROUTES.login, element: <LoginPage /> },

  // Authenticated application
  {
    element: <ProtectedRoute />,
    children: [
      {
        path: ROUTES.home,
        element: <AppLayout />,
        children: [
          { index: true, element: <WelcomePage /> },
          // Module routes are registered here as they are implemented.
          {
            element: <RequirePermission permission={PERMISSIONS.membersRead} />,
            children: [
              {
                path: ROUTES.members,
                element: <MembersPage />,
                handle: meta({ title: 'Members' }),
              },
              {
                path: `${ROUTES.members}/:memberId`,
                element: <MemberDetailPage />,
                handle: meta({ title: 'Member', back: ROUTES.members }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.membersWrite} />,
            children: [
              {
                path: `${ROUTES.members}/new`,
                element: <MemberFormPage />,
                handle: meta({ title: 'Add member', back: ROUTES.members }),
              },
              {
                path: `${ROUTES.members}/:memberId/edit`,
                element: <MemberFormPage />,
                handle: meta({ title: 'Edit member', back: ROUTES.members }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.membershipsRead} />,
            children: [
              {
                path: ROUTES.memberships,
                element: <MembershipsPage />,
                handle: meta({ title: 'Memberships' }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.plansRead} />,
            children: [
              {
                path: ROUTES.plans,
                element: <PlansPage />,
                handle: meta({ title: 'Plans', back: ROUTES.memberships }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.paymentsRead} />,
            children: [
              {
                path: ROUTES.payments,
                element: <PaymentsPage />,
                handle: meta({ title: 'Payments' }),
              },
              {
                path: ROUTES.dues,
                element: <DuesPage />,
                handle: meta({ title: 'Dues' }),
              },
              {
                path: `${ROUTES.payments}/:paymentId`,
                element: <ReceiptPage />,
                handle: meta({ title: 'Receipt', back: ROUTES.payments }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.attendanceRead} />,
            children: [
              {
                path: ROUTES.attendance,
                element: <AttendancePage />,
                handle: meta({ title: 'Check-in' }),
              },
            ],
          },
          {
            element: <RequirePermission permission={PERMISSIONS.staffRead} />,
            children: [
              { path: ROUTES.team, element: <TeamPage />, handle: meta({ title: 'Team' }) },
            ],
          },
          { path: '*', element: <NotFoundPage />, handle: meta({ title: 'Not found' }) },
        ],
      },
    ],
  },
])
