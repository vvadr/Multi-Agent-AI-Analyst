# API Contract

## Invite-only authentication

Production access is invite-only; there is no public registration endpoint.
Passwords are hashed server-side with Argon2. Access tokens are short-lived and
returned only for in-memory browser use. Refresh tokens are opaque, rotated on
every refresh, persisted only as hashes, and sent in an HttpOnly cookie named
`analyst_refresh`.

| Method | Endpoint | Authentication | Purpose |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/login` | None | Returns a bearer access token and sets the refresh cookie. |
| `POST` | `/v1/auth/refresh` | Refresh cookie | Rotates the refresh session and returns a new access token. |
| `POST` | `/v1/auth/logout` | Refresh cookie | Revokes the current refresh session and clears its cookie. |
| `GET` | `/v1/auth/me` | Bearer access token | Returns the current server-verified user and organization. |
| `POST` | `/v1/auth/invites` | Bearer admin token | Creates a one-time organization invitation. |
| `POST` | `/v1/auth/invites/accept` | None | Accepts an invitation and creates or joins the invited account. |

`POST /v1/auth/login` returns:

```json
{
  "access_token": "<short-lived-jwt>",
  "token_type": "bearer",
  "expires_in": 1800,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "organization_id": "uuid",
    "role": "admin"
  }
}
```

The browser must call refresh and logout with `credentials: "include"`; it must
not store the refresh token or any long-lived token in `localStorage`.

## Local demo API

These endpoints are available only when `APP_ENV=development` and
`ENABLE_UNAUTHENTICATED_DEMO_API=true`. They use the server-owned `demo` tenant,
keep runs in process memory, and must never be enabled in production.

## Documents

`POST /v1/documents` accepts multipart form field `file` no larger than
`DEMO_MAX_UPLOAD_BYTES` (10 MB by default). It safely extracts and indexes
PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, and HTML. Password-protected
PDFs and legacy binary Office formats are rejected rather than being parsed by
an unsafe converter. The original is stored in the configured object store.

```json
{"id":"uuid","filename":"report.txt","chunks":3}
```

## Runs

`POST /v1/runs` accepts `{"question":"..."}` and returns HTTP 202:

```json
{"id":"uuid","status":"queued"}
```

`GET /v1/runs/{id}` returns queued, running, completed, or failed status. A
completed result includes the grounded answer and safe citation metadata.

`GET /v1/runs/{id}/events` is a Server-Sent Event stream. Event names are
`run_started`, `routing`, `retrieving`, `querying`, `generating`, `completed`,
and `failed`. Events never contain raw prompts, provider errors, secrets, or
model reasoning.

## Deliberate limits

- The local demo supports text uploads only and has no authentication,
  persistence, run history, or tenant selection.
- The graph can use retrieval, optional Tavily web search, and the synthetic
  `analytics.monthly_metrics` SQL source.
- Completed question/answer pairs are kept in a separate tenant-filtered memory
  collection and recalled for follow-up questions. Use `python -m
  app.evaluation.cli` to run the ten-case Phase 4 evaluation dataset.
- Model-written Python execution remains disabled until a separately deployed,
  locked-down sandbox exists.
