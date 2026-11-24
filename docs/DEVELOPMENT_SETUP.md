# Development Setup

## Prerequisites

| Tool    | Version                                              |
| ------- | ---------------------------------------------------- |
| Node.js | 22.12 or newer (see `.nvmrc`; Vite 8 requires ≥22.12) |
| npm     | 10+                                                  |
| Git     | any recent version                                   |

Recommended VS Code extensions: ESLint, Prettier, Tailwind CSS IntelliSense, EditorConfig.

## 1. Install dependencies

```bash
cd web
npm install
```

or from the repository root: `npm run install:web`.

## 2. Environment variables

```bash
cp web/.env.example web/.env.local
```

- `.env.local` is git-ignored — put real values only there.
- Only variables prefixed with `VITE_` are exposed to the browser. Do **not** put server
  secrets in any frontend env file; Firebase web config values are public identifiers, not secrets.
- Add new variables to both `web/.env.example` and `web/src/types/env.d.ts`.

| Variable                    | Purpose                                 | Required now |
| --------------------------- | --------------------------------------- | ------------ |
| `VITE_APP_NAME`             | Product name shown in the UI            | No           |
| `VITE_APP_ENV`              | `development` / `staging` / `production` | No           |
| `VITE_API_BASE_URL`         | Apps Script web app `/exec` URL         | After deploy |
| `VITE_FIREBASE_*`           | Firebase web app config (AUTHENTICATION.md) | Yes      |

## 3. Run the app

```bash
npm run dev        # http://localhost:5173
```

## 4. Quality checks

```bash
npm run lint          # ESLint
npm run typecheck     # tsc -b (strict)
npm run format:check  # Prettier
npm run test:backend  # Apps Script backend tests (Node, mocked services)
npm run test:web      # frontend unit tests (Vitest)
npm run build         # production build → web/dist
npm run validate      # all of the above
```

All commands work from the repository root (they proxy to `web/`) or inside `web/`.

## App experience (installable web app)

The site behaves like a mobile app:

- **Layout:** phones and tablets (< 1024 px) get a dark app bar with the screen title and back
  arrow, a bottom tab bar (Home, Members, Memberships, More), floating "add" buttons and bottom
  sheets. Desktop keeps the sidebar. Screen titles come from `handle: { title, back }` on each
  route in `src/routes/router.tsx`.
- **Installable (PWA):** `public/manifest.webmanifest` + icons in `public/icons`
  (regenerate with `node scripts/generate-icons.mjs`). Chrome/Edge/Android show an *Install*
  option (also in **More → Install the app**); on iPhone use Safari → Share → *Add to Home Screen*.
  Installed, it opens full-screen without browser bars.
- **Service worker** (`public/sw.js`, production builds only): caches the app shell and hashed
  assets so the app starts instantly and opens offline. It never caches API or Firebase traffic.
  Test it with `npm run build && npm run preview`. Bump `VERSION` in `sw.js` if its caching
  rules change.
- **Instant start:** the last session (role, gym, permissions — no tokens) is kept in
  `localStorage` per user and re-checked with the server in the background; screen data is
  cached in memory (stale-while-revalidate). Both are cleared on sign-out. UI only — the backend
  authorises every request.
- Installing requires HTTPS (or `localhost`), so phones can install it once it is hosted
  (Cloudflare Pages, Phase 12).

## Tooling configuration

| File                         | Notes                                                                 |
| ---------------------------- | --------------------------------------------------------------------- |
| `web/tsconfig.app.json`      | `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `@/*` alias   |
| `web/eslint.config.js`       | Flat config: JS + typescript-eslint + react-hooks + react-refresh, Prettier conflicts disabled |
| `web/.prettierrc.json`       | No semicolons, single quotes, width 100, Tailwind class sorting       |
| `web/vite.config.ts`         | React plugin, Tailwind v4 plugin, `@` → `src` alias                   |
| `.editorconfig`              | UTF-8, LF, 2-space indent                                             |

## Deployment (later — Cloudflare Pages)

Not configured yet. Expected settings:

- Root directory: `web`
- Build command: `npm run build`
- Output directory: `dist`
- Environment variables: set the `VITE_*` values in the Cloudflare dashboard.

`web/public/_redirects` already rewrites all paths to `index.html` so client-side routes work.

## Not configured yet

- Firebase Web API key in `web/.env.local` and Email/Password provider (AUTHENTICATION.md)
- Apps Script Script Properties, DB initialization and deployment (BACKEND_SETUP.md)
- Cloudflare Pages project
- Git repository (`git init`) and remote
