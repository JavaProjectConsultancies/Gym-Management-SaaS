import {
  BarChart3,
  CalendarCheck,
  CreditCard,
  Dumbbell,
  IdCard,
  LayoutDashboard,
  Salad,
  UserRound,
  Users,
} from 'lucide-react'

import type { NavItem } from '@/types/navigation'
import { PERMISSIONS } from '@/utils/permissions'

import { ROUTES } from './paths'

/**
 * Sidebar navigation. Flip `available` to `true` and register a route in
 * `router.tsx` when a module is implemented.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', path: ROUTES.dashboard, icon: LayoutDashboard, available: false },
  {
    label: 'Members',
    path: ROUTES.members,
    icon: Users,
    available: true,
    permission: PERMISSIONS.membersRead,
  },
  {
    label: 'Memberships',
    path: ROUTES.memberships,
    icon: IdCard,
    available: true,
    permission: PERMISSIONS.membershipsRead,
  },
  {
    label: 'Attendance',
    path: ROUTES.attendance,
    icon: CalendarCheck,
    available: true,
    permission: PERMISSIONS.attendanceRead,
  },
  {
    label: 'Payments',
    path: ROUTES.payments,
    icon: CreditCard,
    available: true,
    permission: PERMISSIONS.paymentsRead,
  },
  {
    label: 'Team',
    path: ROUTES.team,
    icon: UserRound,
    available: true,
    permission: PERMISSIONS.staffRead,
  },
  { label: 'Workouts', path: ROUTES.workouts, icon: Dumbbell, available: false },
  { label: 'Diet Plans', path: ROUTES.diets, icon: Salad, available: false },
  { label: 'Reports', path: ROUTES.reports, icon: BarChart3, available: false },
]
