# Frontend — Multi-Agent AI Analyst

Next.js (App Router) + TypeScript + Tailwind CSS. **Owned and implemented by
Claude.** It consumes the backend's versioned OpenAPI + SSE contract and never
holds provider, database, or model secrets.

- Framework: Next.js 15 (App Router, `src/` dir, `@/*` import alias)
- Language: TypeScript
- Styling: Tailwind CSS v4
- Lint: ESLint 9 (flat config)
- Host (production): Vercel

## Prerequisites

- Node.js 20+ (developed on Node 24) and npm.
- A running backend (see `../backend`), reachable at `NEXT_PUBLIC_API_BASE_URL`.

## Install

```powershell
cd frontend
npm install
```

## Environment variables

Only non-secret, browser-exposed `NEXT_PUBLIC_*` values are used here. See
[`../docs/ENVIRONMENT_KEYS.md`](../docs/ENVIRONMENT_KEYS.md) for the full list.

| File | Committed? | Used for |
| --- | --- | --- |
| `.env.example` | yes | Documentation of every variable. |
| `.env.development` | yes | Defaults for `npm run dev` (points at `http://localhost:8000`). |
| `.env.production.example` | yes | Template for production values. |
| `.env.local` | no (gitignored) | Your personal local overrides. |
| `.env.production` | no (gitignored) | Real production values — set these in Vercel instead. |

| Variable | Example | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Backend origin the client calls. |
| `NEXT_PUBLIC_API_V1_PREFIX` | `/v1` | Versioned API prefix (matches backend). |
| `NEXT_PUBLIC_APP_ENV` | `development` | Environment label shown in the UI. |

## Run — development

Hot-reloading dev server on <http://localhost:3000>. Loads `.env.development`.

```powershell
npm run dev
```

The landing page shows a live **Backend status** panel that calls the backend
`/readyz` endpoint — a quick check that the API is reachable and which
server-owned integrations are configured.

## Run — production

Optimized build, then serve it. Loads `.env.production` (copy from the template
for a local prod test; on Vercel the values come from the dashboard).

```powershell
npm run build
npm run start
```

## Quality checks

```powershell
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
```

## Project layout

```text
frontend/
├── src/
│   ├── app/                 # App Router routes, layout, global styles
│   │   ├── layout.tsx
│   │   └── page.tsx         # Landing page + live backend status
│   ├── components/
│   │   └── backend-status.tsx
│   └── lib/
│       ├── api.ts           # Typed API client (REST + SSE) — the only network layer
│       └── config.ts        # Public runtime config from NEXT_PUBLIC_* vars
├── public/
├── .env.example
├── .env.development
└── .env.production.example
```

## Contract boundary

The client calls **only** the backend API. It must not call PostgreSQL, Qdrant,
Gemini, or object storage directly. All requests go through `src/lib/api.ts`,
which mirrors the endpoints documented in
[`../docs/IMPLEMENTATION_SCOPE.md`](../docs/IMPLEMENTATION_SCOPE.md).

> Note: `npm audit` reports advisories in dev-only tooling (ESLint/PostCSS
> transitive deps). Their only offered "fixes" are breaking downgrades of Next
> or ESLint, so do **not** run `npm audit fix --force`. None affect the runtime
> bundle.
