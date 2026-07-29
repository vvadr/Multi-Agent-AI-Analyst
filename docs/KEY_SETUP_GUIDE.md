# Key Setup Guide

Use the committed templates as checklists:

- Development: copy `.env.development.example` to `.env.development`.
- Local production smoke test: copy `.env.production.example` to
  `.env.production`.
- Real production: enter `.env.production.example` values in Render.

Both real files are ignored and are never layered together.

## JWT signing keys

Generate separate values for development and production:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Store the development value only in `.env.development` and the production value
only in Render/`.env.production`.

## Gemini

Create a server-side key in
[Google AI Studio](https://aistudio.google.com/app/apikey). Put it in the
relevant backend environment as `GEMINI_API_KEY`. Dedicated development and
production keys are preferred because either can then be rotated independently.

The configured model IDs are:

```text
GEMINI_MODEL=gemini-3.1-flash-lite
GEMINI_EMBEDDING_MODEL=gemini-embedding-001
```

## LiteLLM development gateway

LiteLLM is local-development infrastructure and is not deployed to Render.
Generate its bearer token:

```powershell
python -c "import secrets; print('sk-' + secrets.token_urlsafe(24))"
```

Put it in `.env.development` as `LITELLM_MASTER_KEY`. This is not a Google key.
The Compose API container receives this token but explicitly receives an empty
`GEMINI_API_KEY`; only the LiteLLM container receives the provider credential.

The gateway container reads its own file, not the backend's. Create it from the
committed template and keep both values in sync with `.env.development`:

```powershell
Copy-Item infra\litellm\litellm.env.example infra\litellm\litellm.env
```

`infra/litellm/litellm.env` is gitignored; the `.example` beside it is not, and
carries placeholders only.

## PostgreSQL

Development uses the Compose PostgreSQL URL already present in the template.
For production, copy the pooled connection URL from Neon or another hosted
provider and use the SQLAlchemy psycopg scheme:

```text
postgresql+psycopg://USER:PASSWORD@HOST:5432/DBNAME?sslmode=require
```

Use a non-owner application role. Never connect the pilot to a company
production database.

## Qdrant

Development uses local Qdrant. For production, create a Qdrant Cloud cluster
and place its HTTPS URL and key in `QDRANT_URL` and `QDRANT_API_KEY`.

Keep `QDRANT_COLLECTION=analyst_documents`. Changing the embedding model or
vector dimensions later requires re-indexing.

## Object storage

Development uses local MinIO. For production Supabase Storage:

1. Create a private `analyst-documents` bucket.
2. Open Storage S3 settings.
3. Copy the endpoint and exact provider region.
4. Create a dedicated S3 access-key pair.
5. Set `OBJECT_STORAGE_ENDPOINT`, `OBJECT_STORAGE_REGION`,
   `OBJECT_STORAGE_ACCESS_KEY_ID`, and
   `OBJECT_STORAGE_SECRET_ACCESS_KEY`.

Production rejects the placeholder `auto` region. The backend uses path-style
S3 addressing.

## Optional providers

- Tavily: configure only after web-search validation and sanitization exist.
- Langfuse: configure only after trace redaction is verified.
- Redis: configure when the durable background worker is implemented.

Leave their values blank until the corresponding feature exists.

## Verify

Install Docker Desktop, then:

```powershell
docker compose -f infra\docker-compose.yml up -d
cd backend
uvicorn app.main:app --reload --port 8000
```

`/healthz` must return 200. `/readyz` must report every required component as
configured and reachable. It never returns credentials or provider error text.
