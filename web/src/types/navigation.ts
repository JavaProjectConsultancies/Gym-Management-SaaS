import type { LucideIcon } from 'lucide-react'

export interface NavItem {
  label: string
  path: string
  icon: LucideIcon
  /** Modules not built yet are shown in the sidebar but are not navigable. */
  available: boolean
  /** Hidden from users whose backend session lacks this permission. */
  permission?: string
}
