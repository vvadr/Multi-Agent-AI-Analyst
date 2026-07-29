# Pre-Deployment and Shipping Readiness Plan

Last audited: 2026-07-30  
Repository branch audited: `staging`

> **Status update (2026-07-30).** The P0 blockers below have been implemented.
> Sections 1–4 and 6 are retained as the record of what was required and why;
> the current state of each is summarised immediately below. What remains is
> operational — provisioning real services, and running the staging and smoke
> procedures in sections 9 and 10 against them. Those cannot be closed from the
> repository.

## Purpose

This document is the release plan for turning the current Multi-Agent AI
Analyst repository into a deployable and shippable pilot.

The words **deployed** and **shipped** mean different things here:

- **Deployed** means Render and Vercel can start the current code and answer
  health checks.
- **Shipped** means an intended user can securely sign in, upload a document,
  start an analysis, observe progress, receive a grounded answer, return later,
  and recover from a service restart without seeing another user's data.

The repository is close to the first definition. It does **not** currently meet
the second definition.

## Executive verdict

> **Code decision: the repository-side P0 blockers are closed.**
> **Deployment decision: pending the staging run in sections 9 and 10.**

The agent graph, ingestion adapters, safe SQL boundary, evaluation foundation,
streaming UI, readiness checks, deployment templates, and optional tracing are
implemented and testable. The browser UI also has strong defensive parsing and
does not render raw SSE payloads, provider errors, or unsafe citation URLs.

The production product boundary is now implemented:

- Document and run endpoints are authenticated and scoped to the caller's
  organization. Unauthenticated requests receive `401`; a resource belonging to
  another organization is reported as `404` so ids cannot be probed.
- The development-only demo API and its configuration have been removed
  entirely rather than merely disabled in production.
- Registration is public, self-service, and single-step: signing up creates a
  workspace and returns a session. There is no confirmation email, so the
  product has no hard dependency on an email provider. Password reset exists
  and revokes every session, but is unavailable and hidden unless SMTP is
  configured. Invitations are retained for adding people to an existing
  workspace. Argon2 hashing, access JWTs, rotated refresh sessions,
  organizations, memberships, and audit events are unchanged.
- Runs and their events are durable rows in PostgreSQL. Work is queued and
  executed by a worker that runs embedded in the API process by default, or as
  a separate service when `REDIS_URL` is set; either way it re-enqueues
  anything stranded by a restart. SSE is replayed from stored events, so
  `Last-Event-ID` resumes exactly.
- PostgreSQL has application tables for documents, runs, run events, citations,
  feedback, daily usage, and the account tokens.
- The frontend registers, signs in, uploads, streams, rejoins an in-flight run
  after a reload, and collects feedback — all authenticated.

**What is deliberately still open:** provisioning PostgreSQL, Qdrant, and object
storage, running migrations against them, and executing the end-to-end smoke
procedure. Also open by choice, and each an accepted limitation rather than an
oversight:

- **No email provider.** Self-service password reset is therefore unavailable;
  an account that loses its password needs an administrator.
- **No separate worker or Redis.** Execution shares the API process, so the web
  tier cannot scale past one instance and a long run competes with request
  handling. Durability is unaffected — the rows and the recovery sweep are the
  same either way.
- The evaluation gate in section 7 remains a foundation rather than an
  acceptance suite, and web search, SQL, and code execution stay disabled.

## Audit scope and evidence

The audit covered:

- FastAPI routes, configuration, middleware, agent graph, ingestion, storage,
  retrieval, SQL, memory, evaluation, observability, and tests.
- Alembic migrations and database session setup.
- Next.js configuration, API client, document upload, SSE handling, workflow
  trace, citation handling, accessibility tests, and production build.
- Render, Docker Compose, Dockerfile, GitHub Actions, Dependabot, environment
  templates, branching guidance, and deployment documentation.
- Current uncommitted Phase 5 changes and diagnostic screenshots.

Important source files:

- Backend route gate: `backend/app/api/routes/documents.py`
- Process-local runs: `backend/app/services/demo_runs.py`
- Production validation: `backend/app/core/config.py`
- Existing migrations: `backend/migrations/versions/`
- Frontend API client: `frontend/src/lib/api.ts`
- Demo-only page copy: `frontend/src/app/page.tsx`
- Render blueprint: `infra/render.yaml`
- CI: `.github/workflows/`
- Intended product scope: `docs/IMPLEMENTATION_SCOPE.md`
- Current API contract: `docs/API_CONTRACT.md`

## Verified state at audit time

| Area | Result | Release meaning |
| --- | --- | --- |
| Backend lint | Passed | Ruff reported no violations. |
| Backend tests | 129 passed | Unit and route tests are green. |
| Backend coverage | **81.33%** | Clears the configured CI gate of 80%. |
| Frontend lint | Passed | ESLint is green. |
| Frontend typecheck | Passed | TypeScript is green. |
| Frontend tests | 395 passed | Vitest is green. |
| Frontend production build | Passed | Builds with no network access to Google Fonts. |
| Compose validation | Passed | `docker compose ... config --quiet` accepted the configuration. |
| Container build | Not verified | Docker daemon access was unavailable in the audit environment. |
| Backend dependency audit | No known vulnerabilities reported | The local project package itself was skipped because it is not a PyPI package. |
| Frontend dependency audit | Not completed | Must be run by the owner/CI against the npm advisory service. |
| Full-history secret scan | Not verified locally | A Gitleaks workflow exists; it must pass on the release PR. |
| Live Render health | Not verified after configuration changes | Earlier screenshots showed startup rejecting a placeholder `ALLOWED_ORIGINS`. |

The frontend font failure may disappear on an internet-connected Vercel or CI
builder, but a production build should not depend on a third-party font request
being available. Self-hosting the fonts or using a system font stack is the
more reliable fix.

## Release severity levels

- **P0 - shipping blocker:** the product is unsafe or unusable without it.
- **P1 - pilot blocker:** the pilot cannot be operated or supported reliably
  without it.
- **P2 - post-pilot hardening:** acceptable only after the pilot boundary is
  explicit and risk is documented.

All P0 and P1 items must be closed before the final production release.

---

# 1. Product and access decision

## P0: Choose the pilot model

Choose one model before implementing production routes:

### Recommended: private, invite-only pilot

- An administrator creates or invites accounts.
- Every document, conversation, run, citation, and memory belongs to an
  organization.
- Users can access only organizations of which they are members.
- Registration is disabled or invite-token protected.

### Alternative: public account pilot

- Public registration requires email verification, abuse controls, rate
  limits, quotas, and an account recovery flow.
- This has a larger security and operations scope.

### Not acceptable as currently implemented: shared anonymous production demo

The current anonymous demo uses one fixed `demo` tenant. Enabling an equivalent
mode publicly would mix documents and recalled answers among unrelated users.
Do not bypass the production validator or simply force
`ENABLE_UNAUTHENTICATED_DEMO_API=true`.

If an anonymous public demo is a firm requirement, design a separate production
demo mode with isolated ephemeral sessions, strict quotas, automatic deletion,
no cross-session memory, and explicit abuse controls.

## Exit criteria

- [ ] Pilot model is written down: private invite-only or public accounts.
- [ ] Data owner and support contact are named.
- [ ] Allowed data classification is documented.
- [ ] Retention period for uploads, answers, memories, logs, and traces is
      approved.
- [ ] Code execution remains disabled for the first release.
- [ ] Web search and SQL are explicitly enabled or disabled for the first
      release.

---

# 2. Production backend API

## P0: Implement authentication

Configuration fields for JWT exist, but authentication code does not.

Implement:

- User and organization membership models.
- Password hashing with a modern password hashing library.
- Invite/registration endpoint according to the chosen pilot model.
- Login endpoint.
- Short-lived access token.
- Refresh-token rotation and revocation, or a documented session alternative.
- Logout/revocation endpoint.
- Authentication dependency for protected FastAPI routes.
- Authorization checks based on server-derived organization and user identity.
- Tests for expired, malformed, revoked, cross-user, and cross-organization
  tokens.

Do not accept `tenant_id`, `organization_id`, or ownership from a browser
request without verifying it against the authenticated membership.

## P0: Freeze the production API contract

There are currently two different contracts:

- The implemented demo uses `POST /v1/runs`.
- `docs/IMPLEMENTATION_SCOPE.md` proposes conversations and
  `POST /v1/conversations/{id}/runs`.

Choose one production contract and update the backend, frontend, OpenAPI tests,
and documentation together.

Minimum production surface:

| Method | Endpoint | Required behavior |
| --- | --- | --- |
| `POST` | `/v1/auth/login` | Authenticate and return/establish a session. |
| `POST` | `/v1/auth/refresh` | Rotate a refresh session. |
| `POST` | `/v1/auth/logout` | Revoke the current refresh session. |
| `POST` | `/v1/documents` | Authorize, store metadata, enqueue ingestion. |
| `GET` | `/v1/documents/{id}` | Return authorized ingestion status. |
| `POST` | `/v1/conversations` | Create an authorized conversation. |
| `POST` | `/v1/conversations/{id}/runs` | Persist and enqueue a run. |
| `GET` | `/v1/runs/{id}` | Return authorized durable run state. |
| `GET` | `/v1/runs/{id}/events` | Stream safe typed events for that user. |
| `POST` | `/v1/runs/{id}/feedback` | Store authorized feedback. |
| `GET` | `/healthz` | Process liveness only. |
| `GET` | `/readyz` | Dependency readiness for operations. |

## P0: Add durable application migrations

The current migrations create only a synthetic analytics table. The initial
migration is empty.

Add migrations for at least:

- `users`
- `organizations`
- `memberships`
- `invites` if using invite-only access
- `refresh_sessions` or equivalent session records
- `documents`
- `document_ingestion_jobs`
- `conversations`
- `runs`
- `run_events`
- `citations`
- `feedback`
- `audit_events`

Required database properties:

- UUID primary keys.
- `created_at` and `updated_at` timestamps where relevant.
- Organization/tenant foreign keys on every owned resource.
- Unique constraints for login identity and membership.
- Indexes for tenant-scoped list and lookup operations.
- Explicit cascade or restrict behavior.
- Run status constraints and safe state transitions.
- Idempotency key support for upload/run creation.
- No plaintext password or refresh token storage.

## P0: Replace process-local execution

`DemoRunStore` stores runs and SSE events in a Python dictionary and uses an
in-process `ThreadPoolExecutor`. A Render restart, deploy, crash, or second
instance loses that state.

Implement:

- Durable run records before work begins.
- Durable event records or a replayable event stream.
- A background worker or durable job mechanism.
- Retry policy with bounded attempts and idempotent operations.
- Stale-run recovery after process restart.
- Cancellation semantics.
- SSE reconnection using a cursor or `Last-Event-ID`.
- A final result retrievable even after the original web process restarts.

`REDIS_URL` exists in configuration but is currently unused. If Redis is chosen,
add the queue/worker deployment and failure recovery. A database-backed queue is
also acceptable for a small pilot if locking and retries are designed and
tested.

## P0: Persist ownership and lifecycle metadata

Document upload currently stores bytes and vectors but does not persist a
document record. If storage succeeds and indexing fails, an orphan object may
remain.

Implement:

- Document row created before upload processing.
- Statuses such as `pending`, `processing`, `ready`, `failed`, and `deleted`.
- Object key, content hash, safe filename, size, parser type, chunk count, and
  failure category.
- Compensating cleanup when storage or indexing partially fails.
- Idempotent vector upsert.
- Authorized deletion from PostgreSQL, object storage, document vectors, and
  conversation memory.
- Retry and re-index operations.

## P0: Enforce the declared agent budgets

Several settings are declared but not fully enforced:

- `MAX_TOOL_CALLS` is not enforced.
- `RUN_TIMEOUT_SECONDS` is used for some network calls but not as a workflow
  wall-clock deadline.
- Token and cost budgets are observed but not enforced.

Implement and test:

- Maximum graph steps.
- Maximum revisions.
- Maximum tool calls.
- End-to-end wall-clock deadline.
- Per-provider-call timeout.
- Maximum input/reference size.
- Maximum output tokens.
- Per-run token and cost ceiling.
- Per-user and per-organization daily quota.
- Deterministic terminal state when a budget is exhausted.

## P1: Production error model

- Return stable machine-readable error codes.
- Keep provider, SQL, storage, and parsing details out of client responses.
- Preserve `X-Request-ID`.
- Distinguish retryable from terminal failures.
- Persist an internal error category for operations without storing secrets or
  raw sensitive content.
- Add FastAPI exception handlers for consistent JSON errors.

## Backend exit criteria

- [ ] Unauthenticated protected requests return `401`, not `404` or `500`.
- [ ] Unauthorized cross-tenant requests return `403` or non-enumerating `404`.
- [ ] Production uploads and runs no longer depend on `_demo_settings`.
- [ ] A web-process restart does not lose run status, answer, citations, or
      events.
- [ ] All production resources are scoped by authenticated organization.
- [ ] All declared run budgets are enforced and tested.
- [ ] OpenAPI matches the frozen frontend contract.

---

# 3. Upload and parser security

## P0: Harden untrusted document processing

The 10 MB request limit is useful, but DOCX and XLSX are ZIP containers and a
small compressed file can expand dramatically. Public document parsing needs
additional controls.

Implement:

- Validate the file structure in addition to its extension.
- Bound decompressed archive size and archive member count.
- Bound page, worksheet, cell, paragraph, and extracted-character counts.
- Parse in a background worker with a strict deadline and memory limit.
- Reject encrypted, malformed, recursive, or suspicious archives.
- Ensure filenames are display metadata only and never filesystem paths.
- Consider malware scanning if the original files will be retained or
  downloaded.
- Add adversarial fixtures: ZIP bomb patterns, malformed PDFs, huge sheets,
  oversized text expansion, nested archives, and parser timeouts.

## P0: Define data retention and deletion

- Keep object storage private.
- Enable provider-side encryption where available.
- Define retention for originals, extracted chunks, vectors, answers, events,
  logs, and traces.
- Add account/organization deletion procedures.
- Verify deletion removes PostgreSQL records, stored objects, Qdrant document
  vectors, and Qdrant memory vectors.
- Document backup scope and recovery limitations of free-tier services.

## P1: Prompt-injection and source safety

The code treats retrieved and web text as untrusted, which is a good base.
Before enabling web search:

- Add adversarial retrieval and web-search tests.
- Enforce URL scheme, redirect, timeout, size, and content limits.
- Do not fetch arbitrary model-provided URLs from the backend.
- Verify citations support every material answer claim.
- Define behavior when evidence is insufficient.
- Keep raw chain-of-thought and hidden prompts out of API responses and traces.

---

# 4. Production frontend

## P0: Replace demo-only product behavior

The current page explicitly says it is a local unauthenticated demo. It has no
account, session, conversation, or history UI.

Implement:

- Login/invite acceptance according to the selected pilot model.
- Authenticated API calls for upload, run creation, polling, and SSE.
- Safe session refresh and logout.
- Conversation creation and selection if conversations remain in the contract.
- Durable document status after asynchronous ingestion.
- Durable run recovery after refresh/revisit.
- Expired-session behavior that does not lose unsent user work.
- Authorized history or a deliberate no-history product decision.
- Production copy that no longer claims the site is a local demo.

The current streaming client uses `fetch`, which can carry an Authorization
header. Preserve that approach if bearer access tokens are used.

## P0: Decide browser session storage

Do not place long-lived tokens in `localStorage`.

Document one design:

- Short-lived access token in memory plus a rotated secure, HttpOnly refresh
  cookie; or
- A secure server-managed session suitable for the cross-origin deployment.

If cookies cross the Vercel/Render origin boundary, configure `Secure`,
`HttpOnly`, `SameSite`, CORS credentials, CSRF protection, and allowed origins
deliberately.

## P1: Make the production build deterministic

The audited build failed because `next/font` attempted to fetch Geist from
Google Fonts.

Preferred fix:

- Self-host the required font files with `next/font/local`, or use a tested
  system font stack.

Acceptance criteria:

- `npm ci && npm run build` passes in a clean environment without access to
  Google Fonts.

## P1: Add browser security headers

Define and verify:

- Content-Security-Policy.
- `frame-ancestors` or equivalent clickjacking protection.
- `X-Content-Type-Options: nosniff`.
- Referrer policy.
- Permissions policy.
- HSTS on the final HTTPS domains.

Keep citation links limited to validated HTTP(S) URLs with
`rel="noopener noreferrer"`.

## P1: Reduce public operational exposure

The current page displays the backend URL and detailed component readiness.
That is useful for development, but decide whether it belongs in the public
pilot.

Recommended:

- Keep `/healthz` public for hosting.
- Restrict detailed `/readyz` or return less component detail publicly.
- Put detailed readiness and dependency names on an operator-only surface.
- Hide the developer readiness panel in the production user UI.

## Frontend exit criteria

- [ ] Production copy contains no local-demo claims.
- [ ] Every product request is authenticated.
- [ ] Session refresh/logout is tested.
- [ ] A browser refresh can recover an active or completed run.
- [ ] The build succeeds without Google Fonts network access.
- [ ] Accessibility tests remain green.
- [ ] No provider/database/storage/JWT secret exists in a `NEXT_PUBLIC_*`
      variable.

---

# 5. Environment and managed services

## Render backend variables

Add each key as a separate Render environment variable. Do not paste the whole
`.env.production` file as the value of one variable.

### Required

```text
APP_ENV=production
API_V1_PREFIX=/v1
LOG_LEVEL=INFO
ALLOWED_ORIGINS=https://<actual-vercel-production-origin>
JWT_SECRET_KEY=<generated-production-secret>
DATABASE_URL=postgresql+psycopg://...
GEMINI_API_KEY=<server-only-secret>
GEMINI_MODEL=<verified-model-id>
GEMINI_EMBEDDING_MODEL=<verified-embedding-model-id>
EMBEDDING_DIMENSIONS=768
QDRANT_URL=https://...
QDRANT_API_KEY=<server-only-secret>
QDRANT_COLLECTION=analyst_documents
OBJECT_STORAGE_BUCKET=analyst-documents
OBJECT_STORAGE_ENDPOINT=https://...
OBJECT_STORAGE_REGION=<provider-region>
OBJECT_STORAGE_ACCESS_KEY_ID=<server-only-secret>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<server-only-secret>
ENABLE_UNAUTHENTICATED_DEMO_API=false
ENABLE_CODE_EXECUTION=false
```

Important:

- Replace every `your-*`, `PROJECT_REF`, `USER`, `PASSWORD`, `HOST`, and
  `DBNAME` placeholder.
- `ALLOWED_ORIGINS` must be the exact HTTPS origin, with no path and preferably
  no trailing slash.
- Many providers return `postgresql://...`; this project explicitly uses the
  Psycopg 3 driver, so normalize it to `postgresql+psycopg://...`.
- Do not set `LITELLM_BASE_URL` in the initial production deployment.
- Do not put any backend value into Vercel `NEXT_PUBLIC_*`.

### Optional and feature-gated

```text
ANALYTICS_DATABASE_URL=<dedicated-read-only-role>
ENABLE_SQL_AGENT=false
TAVILY_API_KEY=<only-if-web-search-is-approved>
ENABLE_WEB_SEARCH=false
LANGFUSE_PUBLIC_KEY=<server-only-secret>
LANGFUSE_SECRET_KEY=<server-only-secret>
LANGFUSE_BASE_URL=https://cloud.langfuse.com
ENABLE_LANGFUSE_TRACING=false
REDIS_URL=<when-the-durable-worker-is-implemented>
```

If SQL is enabled, the analytics URL must use a dedicated read-only role.

## Vercel frontend variables

```text
NEXT_PUBLIC_API_BASE_URL=https://<actual-render-backend-origin>
NEXT_PUBLIC_API_V1_PREFIX=/v1
NEXT_PUBLIC_APP_ENV=production
```

These values are public and embedded during the build.

## P0: Provision and verify managed services

### PostgreSQL

- Create production and staging databases.
- Use separate credentials for migrations and runtime if possible.
- Require TLS.
- Apply migrations before accepting traffic.
- Verify backup/export and restore.
- Verify connection limits and pooling for the selected tier.

The current Render start command runs Alembic with the same `DATABASE_URL` used
by the application. Decide whether to keep that pilot tradeoff or add a
separate migration job/credential. Avoid concurrent migration execution if the
service is scaled beyond one instance.

### Qdrant

- Use separate production and staging collections/projects.
- Confirm vector dimension matches `EMBEDDING_DIMENSIONS`.
- Confirm API keys are server-only.
- Test tenant filters and deletion.
- Define re-index procedure before changing embedding model or dimension.

### Object storage

- Create the private bucket before deployment.
- Confirm `head_bucket` succeeds with the runtime credentials.
- Deny public listing and public object reads.
- Configure CORS only if browsers ever access signed objects directly.
- Define lifecycle and deletion rules.

### Gemini

- Use a dedicated server-side key.
- Restrict the key where supported.
- Verify both generation and embedding model access.
- Define quota-exhaustion behavior.
- Confirm the configured model IDs in staging before release.

---

# 6. CI, source control, and release discipline

## P0: Fix CI branch mapping

Repository documentation uses `staging`, but the push triggers currently name
`main` and `develop`.

Update backend, frontend, and secret-scan workflows so the intended branches
are covered:

```yaml
push:
  branches: [main, staging]
```

Keep pull-request checks enabled.

## P0: Restore the backend coverage gate

Current result:

```text
65 tests passed
Total coverage: 71.79%
Required by CI: 80%
```

Add tests for production-critical paths, especially:

- Run store/worker failure and recovery behavior.
- Provider generation and token usage normalization.
- Object storage success/failure and cleanup.
- Memory isolation and deletion.
- Langfuse disabled/enabled/failure behavior.
- Production route authorization.
- Cross-tenant access.
- Database repositories and migrations.
- Retry, timeout, quota, and idempotency behavior.

CLI entrypoints can be excluded from coverage only through an explicit,
documented policy. Do not lower coverage merely to make CI green.

## P0: Clean and review the release changes

At audit time, the worktree contained uncommitted Phase 5 files and an untracked
`images/` directory.

Before release:

- Review every diff.
- Do not commit diagnostic screenshots unless they are intentionally redacted
  documentation assets.
- Inspect screenshots for hostnames, tokens, keys, database URLs, and account
  identifiers.
- Commit the intended Phase 5 changes on `staging`.
- Push `staging`.
- Open a PR from `staging` to `main`.
- Require all checks on the release PR.

## P0: Security and dependency gates

- Full-history Gitleaks scan passes.
- Backend `pip-audit` passes.
- Frontend runtime dependency audit passes.
- Container image scan passes.
- No real `.env.development`, `.env.production`, LiteLLM env, key, certificate,
  or secret is tracked.
- Any credential ever exposed in Git, chat, logs, or screenshots is rotated.

Do not run an automated breaking dependency "fix" without reviewing the
resulting dependency and application changes.

## P1: Add release automation checks

- Alembic upgrades a fresh PostgreSQL database.
- Alembic upgrades a copy of the current production schema.
- Backend container builds.
- OpenAPI schema is generated and compared for breaking changes.
- Frontend client contract tests use the generated/frozen OpenAPI contract.
- Staging end-to-end smoke test runs after deployment.
- A release tag identifies the shipped commit.

---

# 7. Testing required before shipping

## Unit and contract gates

```powershell
cd backend
.\.venv\Scripts\python.exe -m ruff check .
.\.venv\Scripts\python.exe -m pytest --cov=app --cov-report=term-missing --cov-fail-under=80
.\.venv\Scripts\python.exe -m pip_audit

cd ..\frontend
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

## Integration tests

Run against disposable real services where possible:

- PostgreSQL migrations and repositories.
- Qdrant create/upsert/search/delete with two tenants.
- S3-compatible upload/head/delete and failure cleanup.
- Worker enqueue, claim, retry, restart, and dead-letter behavior.
- SSE reconnect and replay.
- Gemini provider adapter with recorded/mocked responses plus one staging smoke
  call.
- Read-only analytics role rejecting writes.

## Security tests

- Missing, malformed, expired, and revoked access tokens.
- Cross-user and cross-organization document/run access.
- ID enumeration.
- Upload size, archive expansion, parser timeout, malformed document, and
  unsupported format.
- Prompt injection in documents, recalled memory, web results, and SQL-related
  questions.
- SQL bypass attempts, comments, multiple statements, unapproved joins, and
  excessive limits.
- CORS from the actual Vercel origin and rejection from an unapproved origin.
- Rate-limit and quota exhaustion.
- Error responses do not expose provider messages, SQL, paths, prompts, or
  secrets.

## Evaluation gate

The ten-case evaluation dataset is a foundation, not a production acceptance
suite. Before shipping:

- Add representative safe demo documents.
- Add routing cases for retrieval, SQL, web-disabled behavior, and mixed
  evidence.
- Add prompt-injection cases.
- Add insufficient-evidence cases.
- Add citation correctness checks, not only citation presence.
- Define minimum passing thresholds for retrieval, grounding, and judge score.
- Save a versioned baseline report for the release candidate.
- Run optional RAGAS metrics if their provider configuration is approved.

## Performance and resilience tests

- Concurrent users at the expected pilot limit.
- Maximum-size document.
- Slow Gemini/Qdrant/PostgreSQL/object-storage responses.
- Worker restart during ingestion and analysis.
- Web process restart while SSE is connected.
- Provider quota exhaustion.
- Cold start behavior.
- Maximum run duration and cancellation.

---

# 8. Observability and operations

## P1: Production telemetry

Langfuse tracing exists and is disabled by default. It records safe workflow
structure, model metadata, token use, and character counts rather than raw
prompts or answers.

Before enabling:

- Verify the exact payload in staging.
- Confirm retention and access controls.
- Confirm questions, document text, prompts, answers, SQL, and secrets are not
  exported.
- Add trace correlation with run ID and request ID without exposing sensitive
  identifiers.
- Verify tracing failure never fails a user run.

## P1: Metrics and alerts

Add dashboards/alerts for:

- HTTP 5xx and latency.
- Readiness failures by dependency.
- Queue depth and oldest job age.
- Run success/failure/cancellation.
- Ingestion success/failure.
- Provider latency, tokens, cost, and quota errors.
- Database pool exhaustion.
- Qdrant and object-storage errors.
- SSE disconnect/reconnect rate.
- Authentication failures and rate-limit events.

## P1: Operational runbooks

Create or complete:

- Incident response.
- Credential rotation.
- Database backup and restore.
- Qdrant export/re-index.
- Object deletion and retention.
- Provider outage/degraded mode.
- Rollback.
- User data deletion request.
- Abuse report and account suspension.

---

# 9. Staging deployment procedure

Do not perform the first complete test directly in production.

1. Provision separate staging PostgreSQL, Qdrant collection/project, object
   bucket, and credentials.
2. Deploy the backend from `staging`.
3. Run Alembic and verify the expected migration revision.
4. Verify backend liveness:

   ```text
   GET https://<staging-api>/healthz -> 200
   ```

5. Verify backend readiness:

   ```text
   GET https://<staging-api>/readyz -> 200
   ```

6. Confirm unauthenticated protected routes return `401`.
7. Deploy the frontend preview with the staging backend URL.
8. Set backend CORS to the exact staging frontend origin.
9. Complete the end-to-end smoke test below.
10. Restart the backend and worker, then verify documents and runs remain
    available.
11. Review logs/traces for secret or content leakage.
12. Run the evaluation baseline.
13. Record the staging release candidate commit SHA.

---

# 10. End-to-end shipping smoke test

Use only safe synthetic pilot data.

## Account and authorization

- [ ] Invite/register the pilot user.
- [ ] Login succeeds.
- [ ] Invalid login returns generic safe copy.
- [ ] Refresh succeeds and rotates the session.
- [ ] Logout revokes the session.
- [ ] A second organization cannot access the first organization's resources.

## Document flow

- [ ] Upload a supported document.
- [ ] Observe `pending`/`processing`/`ready`.
- [ ] Refresh the browser; document status remains available.
- [ ] Upload an unsupported file and receive safe fixed copy.
- [ ] Upload an oversized/adversarial file and verify bounded failure.

## Analyst flow

- [ ] Create a conversation.
- [ ] Start a retrieval question.
- [ ] Observe safe SSE stages without raw payloads or reasoning.
- [ ] Receive a grounded answer with valid citations.
- [ ] Refresh/reconnect during the run and recover progress.
- [ ] Restart the backend/worker and confirm durable recovery.
- [ ] Ask a follow-up and verify memory remains tenant-scoped.
- [ ] Submit feedback and verify persistence.

## Operations and privacy

- [ ] Every response has an `X-Request-ID`.
- [ ] Logs can correlate the request and run.
- [ ] Client errors contain no provider/database/storage details.
- [ ] Langfuse contains only approved metadata.
- [ ] Delete the test document and verify database, object, document vectors,
      and memory cleanup.
- [ ] `/readyz` is healthy after the test.

---

# 11. Production deployment order

1. Close every P0 item.
2. Close every P1 item or document an explicit owner-approved exception.
3. Merge `staging` to `main` through a green release PR.
4. Tag the release candidate.
5. Back up/export existing production data if any.
6. Apply production migrations using the approved migration process.
7. Deploy the backend and worker from the same release commit.
8. Verify `/healthz` and `/readyz`.
9. Deploy the Vercel frontend with the final Render URL.
10. Update Render `ALLOWED_ORIGINS` to the exact final Vercel origin.
11. Run the complete smoke test.
12. Enable access only for the initial pilot users.
13. Monitor closely through the defined pilot observation window.
14. Mark the release shipped only after the go/no-go record is signed.

---

# 12. Rollback requirements

Before production deployment:

- Identify the last known good backend and frontend commit.
- Know how to roll back Render and Vercel.
- Keep schema changes backward compatible for at least one application release
  where practical.
- Do not rely on destructive Alembic downgrades for emergency rollback.
- Put risky new behavior behind feature flags.
- Keep code execution, web search, SQL, and tracing independently disableable.
- Document how queued/running jobs behave during rollback.
- Verify a rollback does not make newly written rows unreadable.
- Keep credential rotation instructions available if the incident involves
  secret exposure.

Rollback triggers include:

- Authentication or tenant-isolation failure.
- Data loss or cross-user exposure.
- Repeated migration failure.
- Sustained 5xx or failed readiness.
- Run loss after restart.
- Unbounded provider spend or quota exhaustion.
- Sensitive content appearing in logs or traces.

---

# 13. Final go/no-go checklist

## Product

- [ ] Pilot access model approved.
- [ ] Production API contract frozen.
- [ ] Safe demo dataset approved.
- [ ] Privacy, retention, deletion, and support policies approved.

## Backend

- [ ] Authentication and authorization implemented.
- [ ] Durable application schema migrated.
- [ ] Durable worker and SSE recovery implemented.
- [ ] Tenant isolation tested.
- [ ] All run budgets enforced.
- [ ] Upload/parser hardening complete.
- [ ] Rate limits and quotas enabled.
- [ ] Production error model tested.

## Frontend

- [ ] Production authentication/session flow complete.
- [ ] Demo-only copy removed.
- [ ] Production API contract integrated.
- [ ] Active/completed run recovery works.
- [ ] Deterministic production build passes.
- [ ] Security headers verified.
- [ ] Accessibility regression suite passes.

## Infrastructure

- [ ] Production and staging services are separate.
- [ ] Required Render variables contain no placeholders.
- [ ] Vercel points to the final Render origin.
- [ ] Render CORS contains the exact Vercel origin.
- [ ] PostgreSQL backup/restore tested.
- [ ] Qdrant dimension and tenant filters verified.
- [ ] Object bucket is private and lifecycle rules are defined.
- [ ] Provider quotas and billing alerts are configured.

## Quality and security

- [ ] Backend coverage is at least 80%.
- [ ] Frontend lint, typecheck, tests, and build pass.
- [ ] Backend lint, tests, coverage, and dependency audit pass.
- [ ] Frontend runtime dependency audit passes.
- [ ] Container scan passes.
- [ ] Full-history Gitleaks passes.
- [ ] Staging E2E, security, resilience, and evaluation gates pass.
- [ ] No secrets or sensitive screenshots are included in the release.

## Operations

- [ ] Metrics and alerts are active.
- [ ] Incident and rollback runbooks are ready.
- [ ] Last known good release is identified.
- [ ] Smoke-test evidence is recorded.
- [ ] Release owner gives final go approval.

Only after every P0 item and the final checklist pass should this project be
described as **ready to deploy and ship**.
