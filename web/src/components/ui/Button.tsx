import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link, type LinkProps } from 'react-router'

import { cn } from '@/utils/cn'

type Variant = 'primary' | 'secondary' | 'danger' | 'ghost'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-brand-600 text-white shadow-card hover:bg-brand-700 disabled:bg-brand-600/60',
  secondary:
    'border border-border bg-surface text-foreground shadow-card hover:bg-surface-muted disabled:opacity-60',
  danger: 'bg-danger text-white shadow-card hover:bg-red-700 disabled:opacity-60',
  ghost: 'text-muted hover:bg-surface-muted hover:text-foreground disabled:opacity-60',
}

const SIZES: Record<Size, string> = {
  sm: 'gap-1.5 px-3 py-1.5 text-sm',
  md: 'gap-2 px-4 py-2 text-sm',
}

function buttonClasses(variant: Variant = 'primary', size: Size = 'md', className?: string) {
  return cn(
    'inline-flex items-center justify-center rounded-control font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
    VARIANTS[variant],
    SIZES[size],
    className,
  )
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  icon?: ReactNode
}

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={buttonClasses(variant, size, className)}
      {...rest}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  )
}

interface ButtonLinkProps extends LinkProps {
  variant?: Variant
  size?: Size
  icon?: ReactNode
}

export function ButtonLink({
  variant = 'primary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className as string | undefined)} {...rest}>
      {icon}
      {children}
    </Link>
  )
}
