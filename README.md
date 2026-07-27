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

- FastAPI service with versioned API routing and health/readiness endpoints.
- Next.js (App Router, TypeScript, Tailwind) frontend with a typed API client
  and a live backend-status panel.
- Typed, server-only environment configuration.
- Dependency management, tests, linting, Docker, GitHub Actions, and a Render
  deployment template.
- Complete secret templates in `backend/.env.example` and `frontend/.env.example`.

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

Development mode runs against local Docker services (Postgres, Qdrant, MinIO);
production mode uses the connected services. `APP_ENV` selects the mode — see
[Running environments](docs/ENVIRONMENTS.md).

## Start the frontend locally

```powershell
cd frontend
npm install
npm run dev
```

Then open `http://localhost:3000`. `.env.development` already points it at the
local backend.

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
