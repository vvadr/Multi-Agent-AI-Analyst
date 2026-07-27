# Environment Keys — What You Need to Get

> Looking for **step-by-step, click-by-click** instructions to grab each key
> (including Supabase Storage)? See **[KEY_SETUP_GUIDE.md](KEY_SETUP_GUIDE.md)**.
> This page is the quick reference; that one is the walkthrough.

This is the checklist of keys/credentials to obtain. **All secrets are
backend-only.** The frontend has no secrets — it only needs the backend's URL.

Rules that never change:

- Never put a secret in the frontend (`NEXT_PUBLIC_*` is public).
- Never commit a real secret. They live in `backend/.env` locally and in the
  Render/Vercel dashboards in production.
- Never paste keys into chat, screenshots, or issue trackers.

## Minimum to start (local development)

You can boot the whole app locally with just these two:

| Key | How to get it | Notes |
| --- | --- | --- |
| `JWT_SECRET_KEY` | Generate it yourself — not from a provider | Run `python -c "import secrets; print(secrets.token_urlsafe(48))"` |
| `GEMINI_API_KEY` | [Google AI Studio](https://aistudio.google.com/app/apikey) → create API key | Required for agent answers and embeddings |

Put them in `backend/.env`. That's enough for the API to start and for the
frontend status panel to show Gemini as "configured".

## Add as you enable features

| Key(s) | Get from | Needed when |
| --- | --- | --- |
| `DATABASE_URL` | A hosted Postgres provider — [Supabase](https://supabase.com), [Neon](https://neon.tech), etc. Or local Docker for dev. | Accounts, conversations, runs, audit — any DB feature |
| `QDRANT_URL`, `QDRANT_API_KEY` | [Qdrant Cloud](https://cloud.qdrant.io) → create a Free cluster | Document retrieval / vector search |
| `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_ACCESS_KEY_ID`, `OBJECT_STORAGE_SECRET_ACCESS_KEY`, `OBJECT_STORAGE_BUCKET`, `OBJECT_STORAGE_REGION` | An S3-compatible store — [Cloudflare R2](https://developers.cloudflare.com/r2/), Supabase Storage, Backblaze B2 | Persistent document uploads |

## Optional

| Key(s) | Get from | Needed when |
| --- | --- | --- |
| `TAVILY_API_KEY` | [Tavily](https://tavily.com) | Web search is enabled (`ENABLE_WEB_SEARCH=true`) |
| `LANGFUSE_PUBLIC_KEY`, `LANGFUSE_SECRET_KEY` | [Langfuse Cloud](https://cloud.langfuse.com) | Tracing/observability |
| `REDIS_URL` | Any hosted Redis (e.g. Upstash) | A persistent async job queue is added |

## Non-secret config

These are settings, not secrets — safe to commit as defaults. **Every one is
documented (purpose, default, dev vs prod) in
[CONFIG_REFERENCE.md](CONFIG_REFERENCE.md).**

| Variable | Where | Default |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | frontend | `http://localhost:8000` (dev); Render URL (prod) |
| `NEXT_PUBLIC_API_V1_PREFIX` | frontend | `/v1` |
| `NEXT_PUBLIC_APP_ENV` | frontend | `development` / `production` |
| `APP_ENV`, `LOG_LEVEL`, `API_V1_PREFIX`, `ALLOWED_ORIGINS`, `GEMINI_MODEL`, `GEMINI_EMBEDDING_MODEL`, `QDRANT_COLLECTION`, agent budgets, feature flags | backend | See [CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) |

## Where each key goes

| Environment | Location |
| --- | --- |
| Local backend | `backend/.env` (gitignored; copy from `backend/.env.example`) |
| Local frontend | `frontend/.env.development` (defaults) or `frontend/.env.local` (overrides) |
| Production backend | Render → Service → Environment |
| Production frontend | Vercel → Project → Settings → Environment Variables (Production) |

The full backend variable reference lives in
[`../backend/.env.example`](../backend/.env.example); the deployment steps are in
[DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
