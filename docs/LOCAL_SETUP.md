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
Copy-Item .env.development.example .env.development
```

`APP_ENV` defaults to `development`, so the backend loads only
`.env.development`. That file targets the local Docker services; set the two
secrets with no local equivalent:

```env
GEMINI_API_KEY=your-key
JWT_SECRET_KEY=a-random-dev-secret
```

Do not place any value in a committed `*.example` file, Git, chat, screenshots,
or issue trackers. For the full dev/prod split see
[ENVIRONMENTS.md](ENVIRONMENTS.md).

## Run and verify

```powershell
uvicorn app.main:app --reload --port 8000
python -m pytest
ruff check .
```

- `GET http://localhost:8000/healthz` confirms the API process is alive.
- `GET http://localhost:8000/readyz` probes PostgreSQL, the active model
  provider, Qdrant, and object storage. It never returns endpoints,
  credentials, or provider error bodies.
- `GET http://localhost:8000/docs` exposes the development OpenAPI interface.

## Local infrastructure (Docker)

Development mode runs against local Postgres, Qdrant, and MinIO. After Docker
Desktop is installed and running, start the data services:

```powershell
docker compose -f ..\infra\docker-compose.yml up -d postgres qdrant minio createbuckets litellm
```

Then run the backend on the host (hot reload) as above. To run the whole stack
(backend included) in Docker instead:

```powershell
docker compose -f ..\infra\docker-compose.yml up --build
```

Use local infrastructure only for development. Hosted database/vector services
are required for the public pilot because Render's filesystem is ephemeral.
