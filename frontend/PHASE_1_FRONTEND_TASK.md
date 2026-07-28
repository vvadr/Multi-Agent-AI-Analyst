# Phase 1 Frontend Implementation Task

## Objective

Complete the frontend portion of Phase 1 by integrating the finalized backend
health/readiness contract, hardening public runtime configuration, improving the
foundation status page, adding focused tests, and aligning frontend CI with the
project's quality requirements.

This is a frontend-only handoff. The backend foundation, service-readiness
contract, environment structure, database migrations, container setup, and
deployment configuration have already been implemented.

## Current State

The following environment-file housekeeping has already been completed and must
be preserved:

- `frontend/.env.example` was intentionally removed.
- Development environment guidance lives in `frontend/.env.development`.
- Production environment guidance lives in
  `frontend/.env.production.example`.
- The frontend `.gitignore` and README were updated to match this structure.

The frontend source still uses the previous readiness model and therefore needs
to be brought into alignment with the backend contract described below.

## Allowed Scope

The frontend agent may modify:

- `frontend/`
- `.github/workflows/frontend-ci.yml`

Do not modify:

- `backend/`
- Database migrations
- Backend environment files
- Docker or Render deployment files
- Other infrastructure or repository workflows

Preserve all existing user changes. Do not recreate `frontend/.env.example`, and
do not commit credentials, tokens, connection strings, or other secrets.

## Backend Contract

### Liveness

Request:

```http
GET /healthz
```

Response:

```json
{
  "status": "ok"
}
```

### Readiness

Request:

```http
GET /readyz
```

Response body:

```json
{
  "status": "ready",
  "components": {
    "database": {
      "configured": true,
      "reachable": true
    },
    "model": {
      "configured": true,
      "reachable": true
    },
    "qdrant": {
      "configured": true,
      "reachable": true
    },
    "object_storage": {
      "configured": true,
      "reachable": true
    }
  }
}
```

The top-level `status` is either:

- `ready`
- `not_ready`

Every component has two independent properties:

- `configured`: the required service configuration is present.
- `reachable`: the configured service passed its readiness probe.

The readiness endpoint returns HTTP `503 Service Unavailable` when any component
is unavailable. A valid JSON readiness response returned with HTTP 503 is
expected application state. It must be parsed and displayed rather than treated
as a generic request failure.

Every backend response includes an `X-Request-ID` header.

## Required Work

### 1. Harden Frontend Configuration

Update `frontend/src/lib/config.ts`.

Requirements:

- In development, a missing `NEXT_PUBLIC_API_BASE_URL` may default to
  `http://localhost:8000`.
- In production, `NEXT_PUBLIC_API_BASE_URL` is required.
- Production must reject localhost, invalid URLs, obvious placeholder values,
  and non-HTTPS URLs.
- Accept only absolute HTTP or HTTPS URLs.
- Remove trailing slashes from the API base URL.
- Normalize `NEXT_PUBLIC_API_V1_PREFIX` to one leading slash and no trailing
  slash.
- Validate `NEXT_PUBLIC_APP_ENV` instead of accepting arbitrary values.
- Configuration failures should explain which setting is invalid without
  exposing sensitive values.
- Never put a secret in a variable prefixed with `NEXT_PUBLIC_`; these variables
  are embedded in browser-accessible code.

Do not modify backend CORS behavior. Browser origins are controlled by the
backend `ALLOWED_ORIGINS` setting.

### 2. Update the API Client

Update `frontend/src/lib/api.ts` to use the exact readiness response.

The readiness component type should represent:

```ts
type ComponentReadiness = {
  configured: boolean;
  reachable: boolean;
};
```

The supported component keys are exactly:

```ts
type ReadinessComponent =
  | "database"
  | "model"
  | "qdrant"
  | "object_storage";
```

Requirements:

- Replace the previous boolean component fields.
- Parse the body of valid readiness responses returned with HTTP 200 or 503.
- Validate the response structure before the UI consumes it.
- Treat malformed JSON or an invalid readiness structure as an API error.
- Handle network failures and timeouts safely.
- Capture the `X-Request-ID` response header on API errors when it is available.
- Do not expose raw backend exceptions or provider error details to users.
- Preserve unrelated API utilities unless they are demonstrably broken.

The current SSE/run-event client is for a later phase. Do not build a run or
event UI because the corresponding backend product API is not included in Phase
1.

### 3. Update the Foundation Status UI

Update `frontend/src/components/backend-status.tsx` and
`frontend/src/app/page.tsx` as needed.

Display these four backend dependencies:

- PostgreSQL
- Model provider
- Qdrant
- Object storage

Map component data to three distinct user-facing states:

| Condition | Label | Meaning |
| --- | --- | --- |
| `configured === false` | Not configured | Required configuration is absent |
| `configured === true` and `reachable === false` | Unreachable | Configuration exists, but the probe failed |
| `configured === true` and `reachable === true` | Ready | Configuration exists and the probe succeeded |

UI requirements:

- Use visually and textually distinct neutral/warning, error, and success
  states.
- Show the overall backend readiness state.
- A valid HTTP 503 readiness response must display its component states.
- Do not describe a structured 503 readiness response as an API connection
  failure.
- Network failures, timeouts, or malformed responses should display a clear
  connection/error state.
- Show the request ID when an API error contains one so it can be used for
  support and log correlation.
- Include a loading state and a manual refresh/retry action.
- Use semantic markup and an `aria-live` region where status changes need to be
  announced.
- Keep error messages safe and concise. Never display secrets, connection
  strings, stack traces, or raw provider exceptions.
- Keep the page focused on the Phase 1 system foundation.

Do not add authentication screens, dashboards, agent execution, run history, or
other product workflows. Their backend APIs do not exist yet.

### 4. Add Focused Frontend Tests

Add a lightweight test setup using:

- Vitest
- jsdom
- React Testing Library

Add an `npm test` script and update `package-lock.json` through the normal npm
installation workflow.

Test at least:

1. Production configuration rejects a missing API base URL.
2. Production configuration rejects unsafe or invalid API URLs.
3. Development configuration permits the localhost default.
4. A successful HTTP 200 readiness response renders all four components.
5. A valid HTTP 503 response renders partial readiness instead of a generic
   connection error.
6. `Not configured` and `Unreachable` are represented as different states.
7. A network failure renders the connection error state.
8. A request ID is shown when an API error provides one.
9. Refresh/retry performs another readiness request.

Prefer extracting small pure functions for configuration normalization,
readiness validation, or status mapping when doing so makes behavior easier to
test without coupling tests to implementation details.

### 5. Update Frontend CI

Update `.github/workflows/frontend-ci.yml`.

Requirements:

- Ensure the frontend required check reports for every pull request. Do not let
  path filtering cause the required check to disappear.
- Use minimal read-only GitHub permissions.
- Add concurrency cancellation for superseded runs.
- Pin third-party GitHub Actions to immutable commit SHAs and include readable
  version comments.
- Run the following commands:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Use safe, non-secret build values:

```dotenv
NEXT_PUBLIC_APP_ENV=production
NEXT_PUBLIC_API_BASE_URL=https://api.example.invalid
NEXT_PUBLIC_API_V1_PREFIX=/v1
```

Do not place a real production URL or any secret in the workflow.

### 6. Update Frontend Documentation

Update `frontend/README.md` to explain:

- Local installation and development commands.
- Lint, typecheck, test, and production build commands.
- The required public production variables.
- The development localhost fallback.
- The two-field readiness component model.
- Why HTTP 503 from `/readyz` can contain valid and useful readiness data.
- That `NEXT_PUBLIC_*` values are public browser configuration and cannot
  contain secrets.

Preserve the existing environment-file guidance and the intentional removal of
`.env.example`.

## Verification

From the `frontend/` directory, run:

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Investigate and fix failures caused by the frontend work. Do not weaken lint,
TypeScript, tests, or build checks merely to make CI pass.

## Acceptance Criteria

The task is complete when:

- The frontend compiles against the exact backend readiness response.
- PostgreSQL, model provider, Qdrant, and object storage are all displayed.
- Configured and reachable are treated as separate concepts.
- A valid readiness response with HTTP 503 is rendered as structured state.
- Network and malformed-response failures are handled safely.
- Production cannot silently use localhost or an unsafe API URL.
- The API base URL and API prefix are consistently normalized.
- Request IDs are retained and shown for relevant API failures.
- Frontend tests cover the critical configuration, API, and UI behavior.
- Frontend CI runs lint, typecheck, tests, and build on every pull request.
- No secret is placed in a `NEXT_PUBLIC_*` value.
- No backend or infrastructure implementation is changed.
- Existing user changes remain intact.

## Final Handoff

When implementation is finished, report:

- Files changed.
- A short explanation of the implemented behavior.
- Results of lint, typecheck, tests, and production build.
- Any assumptions made.
- Any remaining blockers or work intentionally deferred to a later phase.

