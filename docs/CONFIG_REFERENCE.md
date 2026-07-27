# Configuration Reference — Every Environment Variable

This documents **all** environment variables, especially the non-secret
**settings** (the ones you don't fetch from a provider). For the secret keys and
how to obtain them, see [KEY_SETUP_GUIDE.md](KEY_SETUP_GUIDE.md).

Legend:

- **Secret?** 🔑 = keep server-side, never commit · ⚙️ = plain setting, safe to commit as a default.
- Backend vars come from the mode file `backend/.env.<APP_ENV>` — `.env.development`
  (local services) or `.env.production` (connected services); source of truth:
  `backend/app/core/config.py`. See [ENVIRONMENTS.md](ENVIRONMENTS.md).
- Frontend vars come from `frontend/.env.*` and must be prefixed `NEXT_PUBLIC_`.

---

## Backend — Application

| Variable | Secret? | Default | Dev | Prod | What it does |
| --- | --- | --- | --- | --- | --- |
| `APP_NAME` | ⚙️ | `Multi-Agent AI Analyst API` | same | same | Display name / OpenAPI title. Cosmetic. |
| `APP_ENV` | ⚙️ | `development` | `development` | `production` | Environment switch. **When `production`, the `/docs` OpenAPI UI is disabled** (see `app/main.py`). Set to `production` on Render. |
| `API_V1_PREFIX` | ⚙️ | `/v1` | `/v1` | `/v1` | Prefix for versioned routes. The API is mounted both unprefixed and under this prefix. Change only if you rev the API version. |
| `LOG_LEVEL` | ⚙️ | `INFO` | `INFO` or `DEBUG` | `INFO` | Logging verbosity: `DEBUG`, `INFO`, `WARNING`, `ERROR`. Use `DEBUG` locally when troubleshooting; keep `INFO` in prod. |
| `ALLOWED_ORIGINS` | ⚙️ | `http://localhost:3000` | `http://localhost:3000` | your Vercel URL | **CORS allow-list.** Comma-separated list of frontend origins allowed to call the API. In prod, set this to the deployed frontend URL **only** (drop `localhost`). Wrong value ⇒ browser CORS errors. |

Example for multiple origins:

```env
ALLOWED_ORIGINS=https://app.example.com,https://staging.example.com
```

---

## Backend — API security (JWT)

| Variable | Secret? | Default | Dev | Prod | What it does |
| --- | --- | --- | --- | --- | --- |
| `JWT_SECRET_KEY` | 🔑 | _(none)_ | random | **different** random | Signs access/refresh tokens. Generate per [guide §1](KEY_SETUP_GUIDE.md#1-jwt_secret_key--generate-it-yourself). Use a separate value in prod. Rotating it invalidates all existing tokens. |
| `JWT_ALGORITHM` | ⚙️ | `HS256` | `HS256` | `HS256` | Token signing algorithm. Leave as `HS256` (symmetric) unless you move to asymmetric keys. |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | ⚙️ | `30` | `30`+ | `15`–`30` | Access-token lifetime. Shorter = safer, more re-auth. |
| `REFRESH_TOKEN_EXPIRE_DAYS` | ⚙️ | `7` | `7` | `7`–`30` | Refresh-token lifetime. How long a user stays logged in without re-entering credentials. |

---

## Backend — Database

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `DATABASE_URL` | 🔑 | _(none)_ | Postgres connection string (Neon). See [guide §3](KEY_SETUP_GUIDE.md#3-database_url--neon-postgres). Reminder: switch scheme to `postgresql+psycopg://…` when DB code is wired up. |

---

## Backend — Gemini (LLM + embeddings)

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | 🔑 | _(none)_ | Google AI Studio key. See [guide §2](KEY_SETUP_GUIDE.md#2-gemini_api_key--google-ai-studio). |
| `GEMINI_MODEL` | ⚙️ | `gemini-2.5-flash` | Chat/answer model. `flash` = fast + cheap; switch to a `pro` model for harder reasoning at higher cost/latency. |
| `GEMINI_EMBEDDING_MODEL` | ⚙️ | `gemini-embedding-001` | Model used to embed documents/queries for vector search. **Don't change after indexing** — embeddings from different models aren't comparable; you'd have to re-index everything. |

---

## Backend — Qdrant (vector search)

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `QDRANT_URL` | ⚙️ | _(none)_ | Cluster HTTPS URL. See [guide §4](KEY_SETUP_GUIDE.md#4-qdrant_url--qdrant_api_key--qdrant-cloud). |
| `QDRANT_API_KEY` | 🔑 | _(none)_ | Cluster API key. |
| `QDRANT_COLLECTION` | ⚙️ | `analyst_documents` | Name of the vector collection. Keep stable; changing it points the app at a different (empty) index. |
| `QDRANT_PREFER_GRPC` | ⚙️ | `false` | Use gRPC (`true`) instead of HTTP. Leave `false` for Qdrant Cloud over HTTPS. |

---

## Backend — Object storage (Supabase, S3-compatible)

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `OBJECT_STORAGE_BUCKET` | ⚙️ | `analyst-documents` | Bucket that holds uploaded documents. |
| `OBJECT_STORAGE_ENDPOINT` | ⚙️ | _(none)_ | S3 endpoint URL. Supabase: `https://<ref>.storage.supabase.co/storage/v1/s3`. |
| `OBJECT_STORAGE_REGION` | ⚙️ | `auto` | Must be your Supabase project region (e.g. `ap-southeast-2`), **not** `auto`. |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | 🔑 | _(none)_ | S3 access key ID. |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | 🔑 | _(none)_ | S3 secret access key. |

All five from [guide §5](KEY_SETUP_GUIDE.md#5-object_storage---supabase-storage-s3-compatible--you-still-need-this).

---

## Backend — Optional integrations

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `TAVILY_API_KEY` | 🔑 | _(none)_ | Web-search provider key. Only needed when `ENABLE_WEB_SEARCH=true`. |
| `LANGFUSE_PUBLIC_KEY` | 🔑 | _(none)_ | Langfuse tracing (public half). Optional observability. |
| `LANGFUSE_SECRET_KEY` | 🔑 | _(none)_ | Langfuse tracing (secret half). |
| `LANGFUSE_BASE_URL` | ⚙️ | `https://cloud.langfuse.com` | Langfuse host. Change only for self-hosted Langfuse. |
| `REDIS_URL` | 🔑 | _(none)_ | Redis connection for a persistent async job queue. Leave blank until added. |

---

## Backend — Agent safety budgets & feature flags

These bound cost, latency, and risk. The defaults are deliberately conservative
for a pilot — raise them only when you understand the cost/latency impact.

| Variable | Secret? | Default | What it does |
| --- | --- | --- | --- |
| `MAX_AGENT_STEPS` | ⚙️ | `8` | Max reasoning/tool steps per run. Caps runaway loops. |
| `MAX_TOOL_CALLS` | ⚙️ | `5` | Max tool invocations per run. |
| `RUN_TIMEOUT_SECONDS` | ⚙️ | `60` | Hard wall-clock limit per run. |
| `MAX_RESULT_ROWS` | ⚙️ | `100` | Row cap for SQL/results returned to the model. |
| `SQL_STATEMENT_TIMEOUT_MS` | ⚙️ | `5000` | Per-SQL-statement timeout (ms) on the read-only analytics query path. |
| `ENABLE_WEB_SEARCH` | ⚙️ | `false` | **Keep `false` for the pilot.** Enable only after URL validation, sanitisation, and citation controls are tested (see IMPLEMENTATION_SCOPE.md). |
| `ENABLE_CODE_EXECUTION` | ⚙️ | `false` | **Keep `false`.** Enable only once a locked-down execution sandbox exists. |

---

## Frontend — public config (`NEXT_PUBLIC_*`)

⚠️ Everything here is shipped to the browser. **Never put a secret in a
`NEXT_PUBLIC_` variable.** Files: `.env.development` (committed dev defaults),
`.env.local` (your untracked overrides), Vercel dashboard (prod).

| Variable | Default | Dev | Prod | What it does |
| --- | --- | --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | `http://localhost:8000` | your Render backend URL | Origin the client calls. Must match a value in the backend's `ALLOWED_ORIGINS`. |
| `NEXT_PUBLIC_API_V1_PREFIX` | `/v1` | `/v1` | `/v1` | Versioned prefix; must equal the backend `API_V1_PREFIX`. |
| `NEXT_PUBLIC_APP_ENV` | `development` | `development` | `production` | UI environment label (shown in the status panel). |

---

## Which values must differ between dev and prod?

| Variable | Dev | Prod |
| --- | --- | --- |
| `APP_ENV` | `development` | `production` |
| `JWT_SECRET_KEY` | a dev secret | a **different** secret |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | the Vercel URL only |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | the Render URL |
| `NEXT_PUBLIC_APP_ENV` | `development` | `production` |
| `LOG_LEVEL` | `DEBUG`/`INFO` | `INFO` |

Everything else can start from the defaults. See
[ENVIRONMENTS.md](ENVIRONMENTS.md) for how dev and prod run, and
[DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md) for where prod values live.
