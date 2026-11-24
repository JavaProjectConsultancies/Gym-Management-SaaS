# Gym Management SaaS

A multi-tenant platform for managing gyms and fitness studios: members, memberships,
attendance, payments, trainers, workout and diet plans, and reports.

> **Status:** v0.6.0
> - Frontend shell and Firebase email/password authentication: implemented.
> - Apps Script backend (token verification, multi-tenant authorization, Sheets data layer):
>   implemented; a **test deployment** is live.
> - Phase 4, per-gym spreadsheets: implemented.
> - Phase 5, Members (list, search, add, edit, deactivate): implemented.
> - Phase 6, Memberships (plans, selling/renewing, expiring and lapsed lists, cancel): implemented.
> - Installable mobile-app experience (PWA, bottom tabs, instant start): implemented.
> - Phase 7, Payments (collect full/part payments, pay at sale, dues, receipts with print/WhatsApp share, void): implemented.
> - Phase 8, Attendance (front-desk check-in/out, one visit a day, override with reason, member history): implemented.
> - Phase 9, Team (invite admins/trainers/staff with their own logins, roles, deactivate; trainers on members, "My members"): implemented.
> - Next: Workouts & Diet plans, then Dashboard & Reports.

## Repository layout

| Folder     | Purpose                                                        |
| ---------- | -------------------------------------------------------------- |
| `web/`     | React + TypeScript + Vite frontend (Tailwind CSS, React Router) |
| `backend/` | Google Apps Script API + Google Sheets data layer               |
| `mobile/`  | Reserved for a possible future Android app                     |
| `docs/`    | Project documentation                                          |
| `scripts/` | Backend test runner and concurrency test                       |

See [docs/PROJECT_STRUCTURE.md](docs/PROJECT_STRUCTURE.md) for details.

## Quick start

Requirements: **Node.js 22.12+** and npm 10+.

```bash
# 1. Install frontend dependencies
npm run install:web          # or: cd web && npm install

# 2. (Optional) create local environment file
cp web/.env.example web/.env.local

# 3. Start the dev server → http://localhost:5173
npm run dev
```

## Scripts (run from the repository root)

| Command                | Description                                     |
| ---------------------- | ----------------------------------------------- |
| `npm run dev`          | Start the Vite dev server                       |
| `npm run build`        | Type-check and build the production bundle      |
| `npm run preview`      | Serve the production build locally              |
| `npm run lint`         | Run ESLint                                      |
| `npm run typecheck`    | Run the TypeScript compiler (no emit)           |
| `npm run format`       | Format files with Prettier                      |
| `npm run format:check` | Verify formatting                               |
| `npm run test:backend` | Run backend tests locally (mocked Google)       |
| `npm run test:web`     | Run frontend unit tests (Vitest)                |
| `npm run test`         | Backend + frontend tests                        |
| `npm run validate`     | Lint + typecheck + format + all tests + build   |

## Documentation

- [Project structure](docs/PROJECT_STRUCTURE.md)
- [Development setup](docs/DEVELOPMENT_SETUP.md)
- [Technology stack](docs/TECHNOLOGY_STACK.md)
- [Authentication](docs/AUTHENTICATION.md)
- [Backend setup](docs/BACKEND_SETUP.md)
- [Database design](docs/DATABASE_DESIGN.md)
- [API documentation](docs/API_DOCUMENTATION.md)
- [Security](docs/SECURITY.md)

## Security

Never commit real credentials. Environment files (`.env*`, except `.env.example`), clasp
configuration and service-account files are git-ignored.
