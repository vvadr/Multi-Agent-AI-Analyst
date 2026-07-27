# Running Environments — Development vs Production

The project runs in two clearly separated modes. **Development** runs everything
locally against local data services; **production** uses the connected
(hosted) services. They use different env files, different secrets, and
different commands.

| | Development | Production |
| --- | --- | --- |
| Backend `APP_ENV` | `development` | `production` |
| Backend env file | `backend/.env.development` | `backend/.env.production` (or host dashboard vars) |
| Backend run | `uvicorn app.main:app --reload` | `uvicorn … --host 0.0.0.0 --port $PORT` (no reload) |
| Backend `/docs` UI | enabled | disabled |
| Backend host | localhost:8000 | Render |
| Database | **local** Postgres (Docker) | Neon (hosted) |
| Vector store | **local** Qdrant (Docker) | Qdrant Cloud |
| Object storage | **local** MinIO (Docker) | Supabase Storage |
| Frontend `NEXT_PUBLIC_APP_ENV` | `development` | `production` |
| Frontend run | `npm run dev` | `npm run build` + `npm run start` |
| Frontend env file | `frontend/.env.development` | Vercel dashboard vars |
| Frontend host | localhost:3000 | Vercel |
| Secrets live in | `backend/.env.development` (gitignored) | Render/Vercel dashboards |

## How the backend picks its mode

`backend/app/core/config.py` selects the env file at startup:

1. If `ENV_FILE` is set → use that path (used by Docker/CI).
2. Else `backend/.env.<APP_ENV>` — e.g. `.env.development` or `.env.production`.
3. Else fall back to `backend/.env`.

`APP_ENV` comes from the **launch command's** environment, so it chooses the
mode. On Render there is no file — variables are injected directly and pydantic
reads them from the environment.

```powershell
# development is the default:
uvicorn app.main:app --reload --port 8000
# force production mode locally:
$env:APP_ENV = "production"; uvicorn app.main:app --port 8000
```

## Env file map

| File | Committed? | Purpose |
| --- | --- | --- |
| `backend/.env.example` | yes | Annotated reference of every variable. |
| `backend/.env.development.example` | yes | Dev template (local services). |
| `backend/.env.production.example` | yes | Prod template (connected services). |
| `backend/.env.development` | **no** | Real dev secrets (local services). |
| `backend/.env.production` | **no** | Real prod secrets (connected services). |
| `frontend/.env.development` | yes | Dev defaults (`NEXT_PUBLIC_*`, localhost). |
| `frontend/.env.production.example` | yes | Prod template. |
| `frontend/.env.production` | **no** | Real prod values (or set in Vercel). |

---

## Development mode (all local)

### Prerequisites

- Python 3.11–3.13, Node 20+, npm.
- **Docker Desktop** — required to run the local Postgres/Qdrant/MinIO stack.
  (The backend process still runs on localhost; Docker only provides the data
  services it talks to.)

### 1. Backend env

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.development.example .env.development
# In .env.development set the two secrets that have no local equivalent:
#   GEMINI_API_KEY  and a dev  JWT_SECRET_KEY
```

Everything else in `.env.development` already points at the local Docker
services.

### 2. Start the local data services (Docker)

```powershell
docker compose -f infra/docker-compose.yml up -d postgres qdrant minio createbuckets
```

- Postgres → `localhost:5432` (analyst/analyst)
- Qdrant → `localhost:6333`
- MinIO → `localhost:9000` (console `localhost:9001`, minioadmin/minioadmin)

### 3. Run the backend (hot reload)

```powershell
cd backend
uvicorn app.main:app --reload --port 8000
```

`APP_ENV` defaults to `development`, so `.env.development` is used. Check
`http://localhost:8000/readyz` and `http://localhost:8000/docs`.

### 4. Run the frontend

```powershell
cd frontend
npm install
npm run dev
```

`frontend/.env.development` already points at `http://localhost:8000`. Open
<http://localhost:3000>.

### Alternative: full stack in Docker

Runs the backend in a container too (no host uvicorn):

```powershell
docker compose -f infra/docker-compose.yml up --build
```

---

## Production mode

Production is deployed, not run by hand. Backend and frontend deploy
independently from the same repository.

### Backend (Render)

- Uses `infra/render.yaml` (`APP_ENV=production`, features disabled).
- Secrets are set as Render **environment variables** — never in Git. See
  [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
- Local production-mode smoke test (uses connected services):

  ```powershell
  cd backend
  Copy-Item .env.production.example .env.production   # fill connected-service values
  $env:APP_ENV = "production"
  uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```

### Frontend (Vercel)

- Root directory `frontend`; build `npm run build`.
- Set `NEXT_PUBLIC_API_BASE_URL` (Render URL) and `NEXT_PUBLIC_APP_ENV=production`
  in Vercel's Production environment variables.
- Add the Vercel URL to the backend `ALLOWED_ORIGINS` (drop `localhost` in prod).

## Environment ↔ branch mapping

See [BRANCHING.md](BRANCHING.md): `develop` → preview/staging, `main` →
production.
