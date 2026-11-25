# Project Structure

```
Gym-Management-SaaS/
├── mobile/                     Reserved for a future Android app
├── web/                        Frontend application
│   ├── public/                 Static files copied as-is (favicon, icons, manifest, service worker)
│   ├── src/
│   │   ├── assets/             Images, fonts and other imported assets
│   │   ├── components/
│   │   │   ├── common/         App-wide components (Sidebar, Topbar, BrandMark, FullPageLoader)
│   │   │   ├── forms/          Reusable form controls and form helpers
│   │   │   └── ui/             Low-level design-system primitives (Button, Card, Badge…)
│   │   ├── layouts/            Page shells (AppLayout: dark sidebar + light workspace)
│   │   ├── pages/              Top-level pages (Welcome, 404, auth/LoginPage)
│   │   ├── modules/            Feature modules — one folder per business domain
│   │   │   ├── dashboard/  members/  memberships/  attendance/  payments/
│   │   │   └── trainers/   workouts/ diets/        reports/
│   │   ├── services/
│   │   │   ├── firebase/       firebaseConfig.ts, firebaseAuth.ts
│   │   │   ├── auth/           accountAccess.ts (backend account check)
│   │   │   └── api/            apiClient.ts (Apps Script client)
│   │   ├── hooks/              Shared React hooks (useAuth)
│   │   ├── contexts/           AuthContext.tsx (provider), AuthContextValue.ts (context object)
│   │   ├── routes/             Router config, paths, navigation, ProtectedRoute
│   │   ├── types/              Shared TypeScript types and env typings
│   │   ├── utils/              Pure helper functions and constants
│   │   ├── styles/             globals.css — Tailwind import + design tokens
│   │   └── main.tsx            Application entry point
│   ├── .env.example            Environment variable template
│   ├── eslint.config.js        ESLint flat config
│   ├── .prettierrc.json        Prettier config
│   ├── tsconfig*.json          TypeScript configs (strict)
│   ├── vite.config.ts          Vite config (React, Tailwind, `@` alias)
│   └── package.json
├── backend/
│   ├── apps-script/
│   │   ├── src/                Apps Script source (*.gs) + appsscript.json (clasp rootDir)
│   │   └── .clasp.json.example clasp template (.clasp.json is git-ignored)
│   └── README.md
├── docs/                       This documentation
├── scripts/                    test-backend.mjs (local backend tests), concurrency-test.mjs
├── .editorconfig  .nvmrc  .gitignore
├── package.json                Root scripts that proxy to web/
└── README.md
```

Empty folders contain a `.gitkeep` so Git tracks them. Delete it once the folder has real files.

## Conventions

### Feature modules

Each folder in `src/modules/` owns one business domain. When a module is implemented,
use this internal layout (create only what is needed):

```
modules/members/
├── components/     Components used only by this module
├── pages/          Route-level pages (MembersListPage.tsx, MemberDetailPage.tsx)
├── services/       Module API calls
├── hooks/          Module hooks
├── types.ts        Module types
└── index.ts        Public exports used by routes/
```

Modules must not import from each other's internals; share code through `components/`,
`hooks/`, `services/`, `types/` or `utils/`.

### Adding a module route

1. Build the page in `src/modules/<module>/pages/`.
2. Register it under the `AppLayout` children in `src/routes/router.tsx` (inside
   `ProtectedRoute`) using the path from `src/routes/paths.ts`.
3. Set `available: true` for the item in `src/routes/navigation.ts`.

### Imports

Use the `@/` alias for anything under `src/` (e.g. `import { cn } from '@/utils/cn'`).
It is configured in both `tsconfig.app.json` and `vite.config.ts`.

### Styling

- Use Tailwind utilities backed by the tokens in `src/styles/globals.css`
  (`bg-brand-600`, `bg-sidebar`, `text-muted`, `rounded-card`, `shadow-card`, `w-sidebar`…).
- Never hard-code hex colours in components — add a token instead.

## Design tokens

| Group      | Tokens                                                                      |
| ---------- | --------------------------------------------------------------------------- |
| Brand      | `brand-50` … `brand-900` (emerald), `accent-400/500/600` (amber)            |
| Workspace  | `canvas`, `surface`, `surface-muted`, `border`, `foreground`, `muted`, `subtle` |
| Sidebar    | `sidebar`, `sidebar-elevated`, `sidebar-border`, `sidebar-foreground`, `sidebar-muted`, `sidebar-active` |
| Status     | `success`, `warning`, `danger`, `info`                                      |
| Radius     | `rounded-control` (0.5rem), `rounded-card` (0.875rem)                       |
| Elevation  | `shadow-card`, `shadow-raised`                                              |
| Layout     | `sidebar` (16rem), `topbar` (4rem) — e.g. `w-sidebar`, `h-topbar`           |
