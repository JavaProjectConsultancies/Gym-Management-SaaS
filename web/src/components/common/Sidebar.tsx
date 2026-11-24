import { NavLink } from 'react-router'

import { useAuth } from '@/hooks/useAuth'
import { NAV_ITEMS } from '@/routes/navigation'
import { cn } from '@/utils/cn'

import BrandMark from './BrandMark'

/** Desktop navigation (≥ lg). Phones use the bottom tab bar (MobileNav.tsx). */
export default function Sidebar() {
  const { hasPermission } = useAuth()
  // Built modules are shown only to users allowed to use them; upcoming ones show as "Soon".
  const visibleItems = NAV_ITEMS.filter(
    (item) => !item.available || !item.permission || hasPermission(item.permission),
  )

  return (
    <>
      <aside
        id="app-sidebar"
        className="fixed inset-y-0 left-0 z-40 hidden w-sidebar flex-col border-r border-sidebar-border bg-sidebar lg:flex print:hidden"
      >
        <div className="flex h-topbar items-center justify-between gap-2 px-5">
          <BrandMark />
        </div>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
          <p className="px-3 pb-2 text-[11px] font-semibold tracking-wider text-sidebar-muted uppercase">
            Modules
          </p>
          <ul className="space-y-0.5">
            {visibleItems.map(({ label, path, icon: Icon, available }) => (
              <li key={path}>
                {available ? (
                  <NavLink
                    to={path}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-3 rounded-control px-3 py-2 text-sm font-medium transition-colors',
                        isActive
                          ? 'bg-sidebar-elevated text-white shadow-[inset_3px_0_0_var(--color-sidebar-active)]'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-elevated hover:text-white',
                      )
                    }
                  >
                    <Icon className="size-[18px]" aria-hidden />
                    {label}
                  </NavLink>
                ) : (
                  <span
                    aria-disabled
                    className="flex cursor-not-allowed items-center gap-3 rounded-control px-3 py-2 text-sm font-medium text-sidebar-muted/70"
                  >
                    <Icon className="size-[18px]" aria-hidden />
                    <span className="flex-1">{label}</span>
                    <span className="rounded-full border border-sidebar-border px-1.5 py-px text-[10px] tracking-wide uppercase">
                      Soon
                    </span>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </nav>

        <div className="border-t border-sidebar-border px-5 py-4 text-xs text-sidebar-muted">
          v0.6.0 · Team
        </div>
      </aside>
    </>
  )
}
