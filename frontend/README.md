# Frontend — Multi-Agent AI Analyst

Next.js (App Router) + TypeScript + Tailwind CSS. It consumes the backend's
versioned OpenAPI contract and never holds provider, database, or model secrets.

- Framework: Next.js 15 (App Router, `src/` dir, `@/*` import alias)
- Language: TypeScript
- Styling: Tailwind CSS v4
- Lint: ESLint 9 (flat config)
- Tests: Vitest + jsdom + React Testing Library
- Host (production): Vercel

## Prerequisites

- Node.js 20+ (developed on Node 24) and npm.
- A running backend (see `../backend`), reachable at `NEXT_PUBLIC_API_BASE_URL`.

## Install

```powershell
cd frontend
npm install     # or `npm ci` to install exactly from package-lock.json
```

## Commands

```powershell
npm run dev        # hot-reloading dev server on http://localhost:3000
npm run lint       # ESLint
npm run typecheck  # tsc --noEmit
npm test           # Vitest (single run)
npm run test:watch # Vitest in watch mode
npm run build      # production build
npm run start      # serve the production build
```

CI runs `npm ci`, `npm run lint`, `npm run typecheck`, `npm test`, and
`npm run build` on every pull request.

## Environment variables

**Every `NEXT_PUBLIC_*` value is public.** Next.js inlines these into the
JavaScript sent to the browser, so anyone can read them. Never put an API key,
token, database URL, or any other credential in one — all secrets live in the
backend. See [`../docs/ENVIRONMENT_KEYS.md`](../docs/ENVIRONMENT_KEYS.md).

| File | Committed? | Used for |
| --- | --- | --- |
| `.env.development` | yes | Defaults for `npm run dev` (points at `http://localhost:8000`). |
| `.env.production.example` | yes | Template for production values. |
| `.env.local` | no (gitignored) | Your personal local overrides. |
| `.env.production` | no (gitignored) | Real production values — set these in Vercel instead. |

There is intentionally **no `.env.example`**; development guidance lives in
`.env.development` and production guidance in `.env.production.example`.

| Variable | Required in production? | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | **yes** | Backend origin the client calls. |
| `NEXT_PUBLIC_API_V1_PREFIX` | no (defaults `/v1`) | Versioned API prefix; must match the backend `API_V1_PREFIX`. |
| `NEXT_PUBLIC_APP_ENV` | no (defaults `development`) | `development` or `production`. Any other value is rejected. |

### Validation rules

`src/lib/config.ts` validates this configuration at module load, so a bad
production value fails the build instead of shipping a broken client.

- **Development** may omit `NEXT_PUBLIC_API_BASE_URL` and falls back to
  `http://localhost:8000`. Plain `http` and localhost are allowed.
- **Production requires** `NEXT_PUBLIC_API_BASE_URL` and rejects localhost,
  non-HTTPS URLs, relative or malformed URLs, and obvious placeholders such as
  `https://your-backend.onrender.com`.
- The base URL is normalized to drop query, hash, and trailing slashes; the
  prefix is normalized to exactly one leading slash and no trailing slash
  (`v1`, `/v1/`, and `///v1///` all become `/v1`).

## Backend readiness model

The status panel reads `GET /readyz`. Each of the four dependencies —
PostgreSQL, model provider, Qdrant, object storage — reports **two independent
booleans**:

| `configured` | `reachable` | Shown as | Meaning |
| --- | --- | --- | --- |
| `false` | any | **Not configured** | The backend is missing required settings. |
| `true` | `false` | **Unreachable** | Settings exist, but the probe failed. |
| `true` | `true` | **Ready** | Configured and responding. |

Keeping these separate matters: "the setting is missing" and "the service is
down" need completely different fixes.

### Why HTTP 503 is not an error here

`/readyz` returns **503 Service Unavailable** whenever any dependency is
unavailable — but the body is still a complete, valid readiness report. That is
expected application state, not a failed request, so the client parses 200 and
503 identically and renders per-component detail either way.

Only these are treated as errors: a network failure or timeout, any other HTTP
status, and a body that does not match the contract. Error messages stay
generic — backend exception text and provider details are never displayed. When
the backend supplies an `X-Request-ID` header, it is shown so a failure can be
correlated with server logs.

## Project layout

```text
frontend/
├── src/
│   ├── app/                      # App Router routes, layout, global styles
│   │   ├── layout.tsx
│   │   ├── page.tsx              # Analyst workspace + live backend status
│   │   └── page.test.tsx
│   ├── components/
│   │   ├── analyst-workspace.tsx # Question form, SSE progress, answer
│   │   ├── backend-status.tsx
│   │   ├── citation-list.tsx     # Document / web / analytics sources
│   │   ├── document-upload.tsx   # .txt validation, progress, indexed state
│   │   └── *.test.tsx
│   └── lib/
│       ├── api.ts                # Typed API client — the only network layer
│       ├── config.ts             # Public runtime config + validation
│       ├── documents.ts          # Upload rules + POST /v1/documents contract
│       ├── parse.ts              # Shared defensive field readers
│       ├── readiness.ts          # /readyz contract, parser, status mapping
│       ├── runs.ts               # Run contract, citations, progress labels
│       ├── sse.ts                # Server-Sent Events framing
│       └── *.test.ts
├── public/
├── vitest.config.ts
├── vitest.setup.ts
├── .env.development
└── .env.production.example
```

## Contract boundary

The client calls **only** the backend API. It must not call PostgreSQL, Qdrant,
Gemini, or object storage directly. All requests go through `src/lib/api.ts`,
which mirrors the endpoints documented in
[`../docs/IMPLEMENTATION_SCOPE.md`](../docs/IMPLEMENTATION_SCOPE.md).

## Analyst workspace

The page drives the backend's **development-only, unauthenticated demo API**,
which the backend serves only when `APP_ENV=development` and
`ENABLE_UNAUTHENTICATED_DEMO_API=true`. Against any other backend those routes
return 404 and the UI reports that the demo API is not being served.

| Call | Used for |
| --- | --- |
| `POST /v1/documents` | Multipart `.txt` upload. Indexing is **synchronous**: a 201 means the file is already chunked, embedded, and searchable, so there is nothing to poll. |
| `POST /v1/runs` | Starts a run; returns 202 with the run id. |
| `GET /v1/runs/{id}/events` | Typed SSE progress: `run_started`, `routing`, `retrieving`, `querying`, `generating`, `completed`, `failed`. |
| `GET /v1/runs/{id}` | Final status, grounded answer, and citations. |

Three rules keep model- and provider-controlled text out of the page:

- **Progress copy is keyed by event type alone.** The API client discards SSE
  event payloads entirely (`routing` carries the chosen route, `retrieving`
  carries the source), so no internal trace can reach the DOM. Unknown event
  names are ignored rather than rendered.
- **Failures use fixed local copy.** `GET /v1/runs/{id}` returns an `error`
  string; the parser deliberately does not read it. The same applies to HTTP
  `detail` bodies — each operation maps the status onto its own message and
  keeps only the `X-Request-ID`.
- **Citation URLs are checked before they become links.** Anything that is not
  `http(s)` is dropped during parsing and re-checked at render time, so a
  `javascript:` source cannot produce an anchor. Web citations are labelled as
  external and open with `rel="noopener noreferrer"`.

Client-side upload validation (`.txt`, non-empty, ≤ 1 MB) is a convenience, not
a control: the backend re-checks extension, size, encoding, and emptiness, and
the limit here tracks its `DEMO_MAX_UPLOAD_BYTES` default.

Cancelling a run stops the client following it; the run may still finish on the
server, and the UI says so rather than claiming it was aborted.

> Note: `npm audit` reports advisories in dev-only tooling (Next/ESLint/PostCSS
> transitive deps). Their only offered "fixes" are breaking downgrades of Next
> or ESLint, so do **not** run `npm audit fix --force`. None affect the runtime
> bundle.
