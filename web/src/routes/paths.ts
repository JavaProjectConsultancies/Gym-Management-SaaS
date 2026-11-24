/** Single source of truth for route paths. */
export const ROUTES = {
  home: '/',
  login: '/login',
  dashboard: '/dashboard',
  members: '/members',
  memberships: '/memberships',
  plans: '/memberships/plans',
  attendance: '/attendance',
  payments: '/payments',
  dues: '/payments/dues',
  trainers: '/trainers',
  team: '/team',
  workouts: '/workouts',
  diets: '/diets',
  reports: '/reports',
} as const

export type AppRoute = (typeof ROUTES)[keyof typeof ROUTES]
