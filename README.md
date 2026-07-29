# Multi-Agent AI Analyst

A multi-agent analyst with a custom FastAPI backend and a Next.js frontend.

## Ownership

- **Backend** — custom FastAPI service: API, auth, agents, data, ingestion,
  deployment. (see [`backend/`](backend/))
- **Frontend** — **owned and implemented by Claude**: the Next.js browser UI
  that consumes the backend's OpenAPI + SSE contract. (see [`frontend/`](frontend/))

The frontend never holds provider, database, or model secrets — it only calls
the backend API.

## Current foundation

- FastAPI service with versioned routing, process liveness, and dependency
  readiness probes.
- Next.js (App Router, TypeScript, Tailwind) frontend with a typed API client
  and a live backend-status panel.
- Strictly isolated `development` / `test` / `production` configuration: each
  mode loads exactly one env file (never layered), development refuses remote
  service endpoints, and production refuses to start on an incomplete config.
- Dependency management, tests, linting, Docker, GitHub Actions, and a Render
  deployment template.

## Start the backend locally

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.development.example .env.development
# Fill GEMINI_API_KEY and a dev JWT_SECRET_KEY in .env.development. Do not commit it.
uvicorn app.main:app --reload --port 8000
```

Then open `http://localhost:8000/docs` and `http://localhost:8000/healthz`.

Development mode runs against local Docker services (Postgres, Qdrant, MinIO,
and optional LiteLLM); production uses connected services. `APP_ENV` selects
exactly one environment file — see
[Running environments](docs/ENVIRONMENTS.md).

## Start the frontend locally

```powershell
cd frontend
npm install
npm run dev
```

Then open `http://localhost:3000`. `.env.development` already points it at the
local backend.

## Contributing

**Do all work on `staging`, and push to `staging`.** Never commit or push
directly to `main` — it changes only through a pull request from `staging`.

```bash
git checkout staging
git pull
# ... commit ...
git push
```

See the [branching model](docs/BRANCHING.md) for releases and hotfixes.

## Documentation

- [Running environments (dev vs prod)](docs/ENVIRONMENTS.md)
- [Environment keys — what to get](docs/ENVIRONMENT_KEYS.md)
- [Key setup guide — step by step](docs/KEY_SETUP_GUIDE.md)
- [Configuration reference — every variable](docs/CONFIG_REFERENCE.md)
- [Branching model](docs/BRANCHING.md)
- [Local setup](docs/LOCAL_SETUP.md)
- [Deployment runbook](docs/DEPLOYMENT_RUNBOOK.md)
- [Implementation scope](docs/IMPLEMENTATION_SCOPE.md)
- [Frontend README](frontend/README.md)

Read these before deploying.
