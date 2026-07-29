# Environment Keys

All secrets are backend-only. The frontend receives only the backend URL and
other browser-safe `NEXT_PUBLIC_*` settings.

## Development

Copy `backend/.env.development.example` to the ignored
`backend/.env.development`. Local PostgreSQL, Qdrant, and MinIO credentials are
already represented in the template. Supply:

| Value | Source |
| --- | --- |
| `JWT_SECRET_KEY` | Generate a development-only random value |
| `GEMINI_API_KEY` | Google AI Studio |
| `LITELLM_MASTER_KEY` | Generate a development-only `sk-...` token |

## Production

Use `backend/.env.production.example` as the Render dashboard checklist:

| Values | Provider |
| --- | --- |
| `JWT_SECRET_KEY` | Generate a production-only random value |
| `DATABASE_URL` | Neon or another hosted PostgreSQL provider |
| `GEMINI_API_KEY` | Google AI Studio |
| `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant Cloud |
| `OBJECT_STORAGE_*` | Supabase Storage or another S3-compatible provider |

Production does not deploy LiteLLM, so `LITELLM_BASE_URL` stays blank.

## Optional

- `TAVILY_API_KEY` is needed only after safe web search is implemented.
- `LANGFUSE_*` is needed only when redacted tracing is enabled.
- `REDIS_URL` is needed when the durable async worker is implemented.

## Rules

- Never copy production credentials into `.env.development`.
- Never commit `.env.development`, `.env.production`, or a secret in another
  file.
- Never paste secrets into chat, issues, screenshots, or `NEXT_PUBLIC_*`.
- If a secret reaches Git history, rotate it immediately; deleting the latest
  copy does not invalidate the credential or erase history.

See [KEY_SETUP_GUIDE.md](KEY_SETUP_GUIDE.md) for provider steps and
[CONFIG_REFERENCE.md](CONFIG_REFERENCE.md) for every setting.
