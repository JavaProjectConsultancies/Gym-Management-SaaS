import { Badge } from '@/components/ui/Feedback'
import { initials } from '@/services/members/memberForm'
import type { MemberStatus } from '@/types/member'
import { cn } from '@/utils/cn'

export function StatusBadge({ status }: { status: MemberStatus }) {
  return status === 'ACTIVE' ? (
    <Badge tone="success">
      <span className="size-1.5 rounded-full bg-brand-500" aria-hidden />
      Active
    </Badge>
  ) : (
    <Badge tone="neutral">
      <span className="size-1.5 rounded-full bg-slate-400" aria-hidden />
      Inactive
    </Badge>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={cn(
        'grid shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-700',
        size === 'md' ? 'size-9 text-xs' : 'size-14 text-lg',
      )}
    >
      {initials(name)}
    </span>
  )
}
