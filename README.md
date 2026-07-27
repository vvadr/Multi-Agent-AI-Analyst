# Multi-Agent AI Analyst

Custom backend foundation for a multi-agent analyst. The frontend is intentionally outside this repository workstream.

## Current foundation

- FastAPI service with versioned API routing and health/readiness endpoints.
- Typed, server-only environment configuration.
- Dependency management, tests, linting, Docker, GitHub Actions, and a Render deployment template.
- A complete secret template in `backend/.env.example`.

## Start the backend locally

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
# Add your own values to .env. Do not commit it.
uvicorn app.main:app --reload --port 8000
```

Then open `http://localhost:8000/docs` and `http://localhost:8000/healthz`.

Read [local setup](docs/LOCAL_SETUP.md), the [deployment runbook](docs/DEPLOYMENT_RUNBOOK.md), and the [implementation scope](docs/IMPLEMENTATION_SCOPE.md) before deploying.
