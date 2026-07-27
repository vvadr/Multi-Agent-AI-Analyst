# Free Pilot Deployment Runbook

## Service accounts

Create the following accounts without sharing any credentials in chat:

1. **Google AI Studio:** create a new server-side Gemini key after revoking the key previously shared in chat.
2. **Qdrant Cloud:** create a Free cluster; record its HTTPS URL and an API key.
3. **Hosted PostgreSQL:** create a Free PostgreSQL project. The backend owns the schema and migrations; the provider supplies infrastructure only.
4. **Render:** connect the personal GitHub repository and create a Web Service from `infra/render.yaml` or the `backend` root directory.
5. **Vercel:** connect the same repository and select the `frontend` directory as its root (Claude's Next.js app).
6. **Optional:** create Tavily and Langfuse accounts only when web search and tracing are enabled.

## Render environment variables

Add these in Render's dashboard as secrets. Never put them in `render.yaml` or Git:

```text
JWT_SECRET_KEY
DATABASE_URL
GEMINI_API_KEY
GEMINI_MODEL
GEMINI_EMBEDDING_MODEL
QDRANT_URL
QDRANT_API_KEY
QDRANT_COLLECTION
OBJECT_STORAGE_BUCKET
OBJECT_STORAGE_ENDPOINT
OBJECT_STORAGE_REGION
OBJECT_STORAGE_ACCESS_KEY_ID
OBJECT_STORAGE_SECRET_ACCESS_KEY
ALLOWED_ORIGINS
```

Set `APP_ENV=production`, `ENABLE_WEB_SEARCH=false`, and `ENABLE_CODE_EXECUTION=false` for the first release.

## Vercel environment variables (frontend)

Add these in the Vercel project → Settings → Environment Variables (Production).
They are all public (`NEXT_PUBLIC_*`); there are no frontend secrets:

```text
NEXT_PUBLIC_API_BASE_URL   # the deployed Render backend URL
NEXT_PUBLIC_API_V1_PREFIX  # /v1
NEXT_PUBLIC_APP_ENV        # production
```

After the frontend URL is known, add it to the backend's `ALLOWED_ORIGINS` and
remove `localhost` from the production value.

## First deployment gate

Do not expose the pilot publicly until all of these are true:

- `GET /healthz` is successful from the Render URL.
- `GET /readyz` reports all required integrations as configured.
- The database uses a non-owner, application-specific role in production.
- Qdrant and database credentials are server-only.
- The deployed `ALLOWED_ORIGINS` contains the Vercel frontend URL only.
- No API key or `.env` file appears in `git log --all -- .env backend/.env`.

Free infrastructure is appropriate for a portfolio/pilot deployment, but not an uptime or backup guarantee. Upgrade managed services before storing sensitive data or promising availability.
