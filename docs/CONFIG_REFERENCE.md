# Configuration Reference

Backend configuration comes from exactly one mode-specific file. Real values
are server-only and ignored by Git. Frontend `NEXT_PUBLIC_*` values are public.

## Application

| Variable | Default | Purpose |
| --- | --- | --- |
| `APP_NAME` | `Multi-Agent AI Analyst API` | OpenAPI title |
| `APP_ENV` | `development` | `development`, `test`, or `production` |
| `API_V1_PREFIX` | `/v1` | Versioned API prefix |
| `LOG_LEVEL` | `INFO` | Backend logging threshold |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Comma-separated CORS allow-list |
| `SERVICE_PROBE_TIMEOUT_SECONDS` | `3` | Per-service readiness timeout |
| `MAX_AGENT_REVISIONS` | `1` | Maximum critic-requested graph revisions |
| `ENABLE_UNAUTHENTICATED_DEMO_API` | `false` | Development-only local demo API; production rejects `true` |
| `DEMO_TENANT_ID` | `demo` | Server-owned tenant used by the local demo |
| `DEMO_MAX_UPLOAD_BYTES` | `10000000` | Maximum supported-document upload size for the local demo (10 MB) |
| `DEMO_MAX_CONCURRENT_RUNS` | `1` | Process-local local-demo run concurrency |

Production requires HTTPS origins and rejects localhost and template
placeholders.

## Authentication settings

| Variable | Secret? | Default | Purpose |
| --- | --- | --- | --- |
| `JWT_SECRET_KEY` | yes | none | Token signing key |
| `JWT_ALGORITHM` | no | `HS256` | Token algorithm |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | no | `30` | Access-token lifetime |
| `REFRESH_TOKEN_EXPIRE_DAYS` | no | `7` | Refresh-token lifetime |

Authentication endpoints are implemented in the next project phase.

## PostgreSQL

| Variable | Secret? | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | yes | SQLAlchemy/psycopg connection URL |

Development uses local PostgreSQL. Production uses a non-owner application role
and `sslmode=require`.

## Model provider and LiteLLM

| Variable | Secret? | Default | Purpose |
| --- | --- | --- | --- |
| `GEMINI_API_KEY` | yes | none | Google provider credential |
| `GEMINI_MODEL` | no | `gemini-3.1-flash-lite` | Direct Gemini model ID |
| `GEMINI_EMBEDDING_MODEL` | no | `gemini-embedding-001` | Embedding model |
| `LITELLM_BASE_URL` | no | none | Optional development gateway |
| `LITELLM_MASTER_KEY` | yes | none | Gateway bearer token |
| `LITELLM_MODEL` | no | `flash-lite` | Gateway chat alias |
| `LITELLM_EMBEDDING_MODEL` | no | `gemini-embedding` | Gateway embedding alias |

Development uses LiteLLM when `LITELLM_BASE_URL` is set. The Compose API
container does not receive `GEMINI_API_KEY`; only LiteLLM does. Production
leaves `LITELLM_BASE_URL` blank and calls Gemini directly.

## Qdrant

| Variable | Secret? | Default | Purpose |
| --- | --- | --- | --- |
| `QDRANT_URL` | no | none | Vector service URL |
| `QDRANT_API_KEY` | yes | none | Vector service credential |
| `QDRANT_COLLECTION` | no | `analyst_documents` | Collection name |
| `QDRANT_PREFER_GRPC` | no | `false` | Prefer gRPC transport |

## Object storage

| Variable | Secret? | Default | Purpose |
| --- | --- | --- | --- |
| `OBJECT_STORAGE_BUCKET` | no | `analyst-documents` | Private upload bucket |
| `OBJECT_STORAGE_ENDPOINT` | no | none | S3-compatible endpoint |
| `OBJECT_STORAGE_REGION` | no | `auto` | Provider region; explicit in production |
| `OBJECT_STORAGE_ACCESS_KEY_ID` | yes | none | S3 access key |
| `OBJECT_STORAGE_SECRET_ACCESS_KEY` | yes | none | S3 secret key |

The S3 client uses path-style addressing for MinIO and Supabase compatibility.

## Optional integrations and safety budgets

| Variable | Secret? | Default |
| --- | --- | --- |
| `TAVILY_API_KEY` | yes | none |
| `LANGFUSE_PUBLIC_KEY` | yes | none |
| `LANGFUSE_SECRET_KEY` | yes | none |
| `LANGFUSE_BASE_URL` | no | `https://cloud.langfuse.com` |
| `REDIS_URL` | yes | none |
| `MAX_AGENT_STEPS` | no | `8` |
| `MAX_TOOL_CALLS` | no | `5` |
| `RUN_TIMEOUT_SECONDS` | no | `60` |
| `MAX_RESULT_ROWS` | no | `100` |
| `SQL_STATEMENT_TIMEOUT_MS` | no | `5000` |
| `ENABLE_WEB_SEARCH` | no | `false` |
| `ENABLE_CODE_EXECUTION` | no | `false` |

Web search and code execution remain disabled for the pilot foundation.

## Frontend public configuration

| Variable | Development | Production |
| --- | --- | --- |
| `NEXT_PUBLIC_API_BASE_URL` | `http://localhost:8000` | Render API URL |
| `NEXT_PUBLIC_API_V1_PREFIX` | `/v1` | `/v1` |
| `NEXT_PUBLIC_APP_ENV` | `development` | `production` |

Never place a provider, database, JWT, storage, or gateway credential in a
`NEXT_PUBLIC_*` variable.
