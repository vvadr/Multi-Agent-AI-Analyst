# Backend

Custom FastAPI API and platform foundation for the Multi-Agent AI Analyst.
Browser UI code belongs in `frontend/`.

## Environment isolation

The backend loads exactly one mode-specific file:

- Development: `.env.development`, copied from `.env.development.example`.
- Production: `.env.production`, copied from `.env.production.example` only
  for a local smoke test. Render receives the same values through its dashboard.
- Test: no dotenv file.

Real files are ignored. Development refuses remote PostgreSQL, Qdrant, object
storage, Redis, and LiteLLM endpoints, preventing accidental access to
production data.

## Run locally

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.development.example .env.development
uvicorn app.main:app --reload --port 8000
```

Use Docker Desktop and `../infra/docker-compose.yml` for local PostgreSQL,
Qdrant, MinIO, and the optional LiteLLM gateway.

## Operations

- `/healthz` is process-only liveness.
- `/readyz` probes PostgreSQL, the active model provider, Qdrant, and object
  storage. It returns 503 when a required dependency is unavailable.
- `alembic upgrade head` applies database migrations.

See [environment documentation](../docs/ENVIRONMENTS.md) and the
[configuration reference](../docs/CONFIG_REFERENCE.md).
