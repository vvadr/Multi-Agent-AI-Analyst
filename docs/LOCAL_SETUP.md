# Local Backend Setup

## Prerequisites

- Python 3.11–3.13. Python 3.13 is already available in this workspace.
- Git.
- Docker Desktop is optional. It is needed only for the local PostgreSQL + Qdrant stack in `infra/docker-compose.yml`.

## Install Python dependencies

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.example .env
```

Set the minimum local values in `backend/.env`:

```env
GEMINI_API_KEY=your-rotated-key
JWT_SECRET_KEY=a-new-random-secret
```

Do not place any value in `.env.example`, Git, chat, screenshots, or issue trackers.

## Run and verify

```powershell
uvicorn app.main:app --reload --port 8000
python -m pytest
ruff check .
```

- `GET http://localhost:8000/healthz` confirms the API process is alive.
- `GET http://localhost:8000/readyz` reports whether database, Gemini, and Qdrant configuration values exist. It never returns credentials.
- `GET http://localhost:8000/docs` exposes the development OpenAPI interface.

## Optional local infrastructure

After Docker Desktop is installed and running:

```powershell
docker compose -f ..\infra\docker-compose.yml up --build
```

Use local infrastructure only for development. Hosted database/vector services are required for the public pilot because Render's filesystem is ephemeral.
