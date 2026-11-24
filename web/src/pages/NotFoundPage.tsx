import { Link } from 'react-router'

import { ROUTES } from '@/routes/paths'

export default function NotFoundPage() {
  return (
    <div className="grid place-items-center py-24 text-center">
      <p className="text-sm font-semibold text-brand-600">404</p>
      <h1 className="mt-2 text-2xl">Page not found</h1>
      <p className="mt-2 text-muted">The page you are looking for does not exist yet.</p>
      <Link
        to={ROUTES.home}
        className="mt-6 rounded-control bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-card hover:bg-brand-700"
      >
        Back to home
      </Link>
    </div>
  )
}
