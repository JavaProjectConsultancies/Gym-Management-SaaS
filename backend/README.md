# Backend — Google Apps Script

Secure API for the Gym Management SaaS. It runs as an Apps Script web app with a central
Google Sheets database. It verifies Firebase ID tokens and enforces role- and gym-based access.

**Status:** source code and tests ready. **Not pushed or deployed.**

| Doc | Contents |
| --- | -------- |
| [docs/BACKEND_SETUP.md](../docs/BACKEND_SETUP.md) | Step-by-step setup, Script Properties, init, provisioning, deployment |
| [docs/DATABASE_DESIGN.md](../docs/DATABASE_DESIGN.md) | Tabs, columns, IDs, roles and permissions |
| [docs/API_DOCUMENTATION.md](../docs/API_DOCUMENTATION.md) | Request/response format, endpoints, error codes, Apps Script limits |
| [docs/AUTHENTICATION.md](../docs/AUTHENTICATION.md) | Token verification design and revocation |
| [docs/SECURITY.md](../docs/SECURITY.md) | Threat model and deployment security |

Quick commands (from the repo root):

```bash
npm run test:backend                       # local tests (mocked Google, in-memory sheets)
cd backend/apps-script && npx clasp push   # upload source (after clasp setup) — not a deployment
```

Never commit `.clasp.json`, `.clasprc.json`, tokens, API keys or spreadsheet exports.
