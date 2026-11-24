# Technology Stack

## Frontend (`web/`)

| Package                     | Version   | Role                                  |
| --------------------------- | --------- | ------------------------------------- |
| react / react-dom           | 19.3      | UI library                            |
| typescript                  | 6.0       | Type system (strict mode)             |
| vite                        | 8.3       | Dev server and bundler                |
| @vitejs/plugin-react        | 6.1       | React support for Vite                |
| tailwindcss                 | 4.3       | Utility-first CSS, theme tokens via `@theme` |
| @tailwindcss/vite           | 4.3       | Tailwind integration for Vite         |
| react-router                | 7.18      | Client-side routing (data router)     |
| lucide-react                | 1.78      | Icon set                              |
| firebase                    | 13.4      | Firebase Auth (modular SDK; only `firebase/app` + `firebase/auth` are imported) |

### Tooling

| Package                       | Version | Role                                   |
| ----------------------------- | ------- | -------------------------------------- |
| eslint / @eslint/js           | 10      | Linting (flat config)                  |
| typescript-eslint             | 8.74    | TypeScript lint rules                  |
| eslint-plugin-react-hooks     | 7.1     | Rules of Hooks + React Compiler rules  |
| eslint-plugin-react-refresh   | 0.5     | Fast-refresh safe exports              |
| eslint-config-prettier        | 10      | Disables rules that conflict with Prettier |
| globals                       | 17      | Browser/Node global definitions        |
| prettier                      | 3.10    | Code formatting                        |
| prettier-plugin-tailwindcss   | 0.8     | Sorts Tailwind classes                 |

Exact resolved versions are locked in `web/package-lock.json`.

### Version decisions

- **TypeScript 6.0, not 7.** The Vite template now ships TypeScript 7 (native compiler), but
  `typescript-eslint` currently supports TypeScript `<6.1`. TypeScript is pinned to `~6.0.3`
  so linting and type-checking use the same compiler. Revisit when typescript-eslint adds TS 7 support.
- **React Router 7, not 8.** React Router 8 requires Node.js ≥22.22. Stay on v7 until the
  team's minimum Node version is raised.
- **`npm audit` reports 4 "high" advisories in `@grpc/grpc-js`**, pulled in by
  `@firebase/firestore`'s Node build. Firestore is not imported, and the browser bundle contains
  no gRPC code (verified). `npm audit fix --force` would downgrade Firebase to v9, so it is not
  applied. Re-check when Firebase updates the dependency.
- **ESLint instead of oxlint.** The current Vite template defaults to oxlint; ESLint was chosen
  per project requirements and for its plugin ecosystem.

## Backend

| Technology            | Role                                                   | Status         |
| --------------------- | ------------------------------------------------------ | -------------- |
| Google Apps Script    | API layer as a web app (V8 runtime)                    | Code ready, not deployed |
| Google Sheets         | Central platform DB (Gyms, Users, Gym_Settings, Audit log); per-gym sheets later | Schema + init ready |
| Firebase Authentication | Email/password sign-in; tokens verified via Google Identity Toolkit | Frontend integrated; API key pending |
| clasp (optional, local devDependency) | Push source to Apps Script            | Not installed |

## Hosting

| Technology        | Role                                      | Status         |
| ----------------- | ----------------------------------------- | -------------- |
| Cloudflare Pages  | Static hosting of `web/dist`              | Not configured |

## Mobile

Reserved (`mobile/`). Technology not yet chosen.
