# Running Environments

Development and production are isolated. The backend never layers production
credentials into a development process.

| | Development | Test | Production |
| --- | --- | --- | --- |
| `APP_ENV` | `development` | `test` | `production` |
| Dotenv file | `.env.development` | none | `.env.production` or host variables |
| Data services | Local Docker | mocked/ephemeral | Connected managed services |
| Backend host | localhost | test process | Render |
| API docs | enabled | enabled | disabled |
| Frontend host | localhost | — | Vercel |

## Selection rules

`backend/app/core/config.py` applies this order:

1. `ENV_FILE`, when explicitly set for CI or a diagnostic run.
2. `.env.development` when `APP_ENV=development` or no mode is supplied.
3. No file when `APP_ENV=test`.
4. `.env.production` when the process environment sets
   `APP_ENV=production`.

Process environment variables override dotenv values. Invalid modes fail
validation. Production also fails startup when required services are missing,
CORS contains localhost/placeholders, or object storage has no provider region.
Development fails when a stateful service points at a remote host.

## File map

| File | Committed? | Purpose |
| --- | --- | --- |
| `backend/.env.development.example` | yes | Complete local-development template |
| `backend/.env.development` | no | Real development values |
| `backend/.env.production.example` | yes | Production/Render checklist |
| `backend/.env.production` | no | Optional local production smoke-test values |
| `frontend/.env.development` | yes | Browser-safe development defaults |
| `frontend/.env.production.example` | yes | Vercel checklist |
| `frontend/.env.production` | no | Optional local production frontend values |

## Development

Install Docker Desktop, then:

```powershell
Copy-Item backend\.env.development.example backend\.env.development
# Fill a development JWT secret, Gemini key, and LiteLLM master key.
docker compose -f infra\docker-compose.yml up -d
cd backend
uvicorn app.main:app --reload --port 8000
```

The local services are PostgreSQL, Qdrant, MinIO, and LiteLLM. The API receives
the LiteLLM token but not the Gemini key; only the proxy receives the provider
key while the gateway is enabled.

## Test

`tests/conftest.py` forces `APP_ENV=test` before application import. Tests do not
load either real dotenv file and mock all external service probes.

## Production

Render sets `APP_ENV=production` and injects secrets through the dashboard.
Production calls Gemini directly; LiteLLM remains a local-development tool.

For a local production smoke test only:

```powershell
Copy-Item backend\.env.production.example backend\.env.production
$env:APP_ENV = "production"
cd backend
alembic upgrade head
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

Never copy production values into `.env.development`.

## Branch mapping

- `main` → production. Never pushed to directly; changed only by PR from
  `staging`.
- `staging` → preview/staging. **This is the branch you work on and push to.**
- Feature branches → pull-request validation.

See [BRANCHING.md](BRANCHING.md) and
[DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
