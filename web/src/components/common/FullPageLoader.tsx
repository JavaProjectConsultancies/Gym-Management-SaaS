import { Loader2 } from 'lucide-react'

export default function FullPageLoader({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="grid min-h-dvh place-items-center bg-canvas">
      <div className="flex flex-col items-center gap-3 text-muted">
        <Loader2 className="size-7 animate-spin text-brand-600" aria-hidden />
        <span className="text-sm">{label}</span>
      </div>
    </div>
  )
}
