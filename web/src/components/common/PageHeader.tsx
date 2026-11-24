import { ChevronLeft } from 'lucide-react'
import type { ReactNode } from 'react'
import { Link } from 'react-router'

import Button, { ButtonLink } from '@/components/ui/Button'

interface PageHeaderProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  back?: { to: string; label: string }
  /**
   * The screen's main "add" action. Desktop: a button in the header.
   * Phones: a floating action button above the tab bar, like a native app.
   */
  fab?: { label: string; icon: ReactNode } & ({ to: string } | { onClick: () => void })
}

/**
 * On phones the title and back arrow live in the app bar (MobileNav.tsx), so
 * only the description and secondary actions are shown here.
 */
export default function PageHeader({ title, description, actions, back, fab }: PageHeaderProps) {
  const hasMobileContent = Boolean(description || actions)
  return (
    <>
      <header className={hasMobileContent ? 'mb-4 lg:mb-6' : 'mb-0 lg:mb-6'}>
        {back && (
          <Link
            to={back.to}
            className="mb-3 hidden items-center gap-1 text-sm font-medium text-muted hover:text-foreground lg:inline-flex"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {back.label}
          </Link>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h1 className="hidden truncate text-2xl lg:block">{title}</h1>
            {description && <p className="text-sm text-muted lg:mt-1">{description}</p>}
          </div>
          {(actions || fab) && (
            <div className="flex shrink-0 flex-wrap gap-2">
              {actions}
              {fab && (
                <span className="hidden lg:inline-flex">
                  {'to' in fab ? (
                    <ButtonLink to={fab.to} icon={fab.icon}>
                      {fab.label}
                    </ButtonLink>
                  ) : (
                    <Button onClick={fab.onClick} icon={fab.icon}>
                      {fab.label}
                    </Button>
                  )}
                </span>
              )}
            </div>
          )}
        </div>
      </header>

      {fab &&
        ('to' in fab ? (
          <Link to={fab.to} aria-label={fab.label} className={FAB_CLASS}>
            {fab.icon}
            <span>{fab.label}</span>
          </Link>
        ) : (
          <button type="button" onClick={fab.onClick} aria-label={fab.label} className={FAB_CLASS}>
            {fab.icon}
            <span>{fab.label}</span>
          </button>
        ))}
    </>
  )
}

const FAB_CLASS =
  'fixed right-4 bottom-tabbar z-20 mb-3 inline-flex h-14 items-center gap-2 rounded-2xl bg-brand-600 px-5 font-semibold text-white shadow-[0_8px_24px_rgb(5_150_105/0.35)] active:scale-95 active:bg-brand-700 lg:hidden'
