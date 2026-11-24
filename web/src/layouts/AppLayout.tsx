import { Outlet, useLocation } from 'react-router'

import { BottomTabBar, MobileAppBar } from '@/components/common/MobileNav'
import Sidebar from '@/components/common/Sidebar'
import Topbar from '@/components/common/Topbar'

/**
 * Application shell.
 *   Phones/tablets (< lg): native-app layout — dark app bar with the screen title
 *   and back arrow, bottom tab bar, safe-area padding for notches.
 *   Desktop (≥ lg): fixed dark sidebar and a light workspace with a top bar.
 */
export default function AppLayout() {
  const location = useLocation()

  return (
    <div className="min-h-dvh bg-canvas">
      <Sidebar />
      <div className="flex min-h-dvh flex-col lg:pl-sidebar print:pl-0">
        <MobileAppBar />
        <Topbar />
        <main className="flex-1 px-4 pt-4 pb-tabbar sm:px-6 lg:px-8 lg:py-8 print:p-0">
          {/* Re-keyed per screen for a subtle app-like transition. */}
          <div key={location.pathname} className="mx-auto w-full max-w-7xl animate-page-in">
            <Outlet />
          </div>
        </main>
      </div>
      <BottomTabBar />
    </div>
  )
}
