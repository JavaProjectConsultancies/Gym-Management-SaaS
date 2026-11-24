import { Building2, Clock } from 'lucide-react'
import type { ReactNode } from 'react'

import { useAuth } from '@/hooks/useAuth'
import type { SessionResponse } from '@/types/api'

type Gym = NonNullable<SessionResponse['gym']>

/**
 * Renders `children(gym)` for users who belong to a gym whose data store is
 * ready. Platform admins (no gym) and gyms awaiting setup get an explanation.
 */
export default function GymGate({ children }: { children: (gym: Gym) => ReactNode }) {
  const { session } = useAuth()
  const gym = session?.gym ?? null

  if (!gym) {
    return (
      <Notice
        icon={<Building2 className="size-6" aria-hidden />}
        title="No gym selected"
        body="This page shows one gym's data. Platform administrators cannot open gym pages yet."
      />
    )
  }
  if (!gym.dataStoreReady) {
    return (
      <Notice
        icon={<Clock className="size-6" aria-hidden />}
        title="Your gym is being set up"
        body="Your gym's data store has not been created yet. Ask the platform administrator to run initializeGymDatabases."
      />
    )
  }
  return <>{children(gym)}</>
}

function Notice({ icon, title, body }: { icon: ReactNode; title: string; body: string }) {
  return (
    <div className="grid place-items-center py-24 text-center">
      <span className="grid size-12 place-items-center rounded-full bg-surface-muted text-muted">
        {icon}
      </span>
      <h1 className="mt-4 text-xl">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-muted">{body}</p>
    </div>
  )
}
