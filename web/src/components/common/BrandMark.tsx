import { Dumbbell } from 'lucide-react'

import { cn } from '@/utils/cn'
import { APP_NAME } from '@/utils/constants'

interface BrandMarkProps {
  /** Show the product name next to the logo mark. */
  withName?: boolean
  className?: string
}

export default function BrandMark({ withName = true, className }: BrandMarkProps) {
  return (
    <div className={cn('flex items-center gap-3', className)}>
      <span className="grid size-9 shrink-0 place-items-center rounded-control bg-brand-500 text-white shadow-raised">
        <Dumbbell className="size-5" strokeWidth={2.25} aria-hidden />
      </span>
      {withName && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-sm font-semibold text-sidebar-foreground">{APP_NAME}</span>
          <span className="text-xs text-sidebar-muted">Admin Console</span>
        </span>
      )}
    </div>
  )
}
