# Running Environments — Development vs Production

The project runs in two clearly separated environments. Keep them apart: dev is
for building and testing on your machine; prod is the deployed pilot. They use
different config, different secrets, and different run commands.

| | Development | Production |
| --- | --- | --- |
| Backend `APP_ENV` | `development` | `production` |
| Backend run | `uvicorn app.main:app --reload` | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` (no reload) |
| Backend `/docs` (OpenAPI UI) | enabled | disabled |
| Backend host | localhost:8000 (or Docker) | Render |
| Frontend `NEXT_PUBLIC_APP_ENV` | `development` | `production` |
| Frontend run | `npm run dev` | `npm run build` + `npm run start` |
| Frontend env file | `.env.development` | Vercel dashboard vars (`.env.production`) |
| Frontend host | localhost:3000 | Vercel |
| Data stores | local Docker Postgres/Qdrant, or free hosted | hosted Postgres, Qdrant Cloud, object storage |
| Secrets live in | `backend/.env` (gitignored) | Render/Vercel dashboards (never in Git) |

The backend already switches behaviour on `APP_ENV`: OpenAPI docs are served
only when `APP_ENV != production` (see `backend/app/main.py`).

## Development

### Backend

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
Copy-Item .env.example .env   # then fill in values; keep APP_ENV=development
uvicorn app.main:app --reload --port 8000
```

Optional local Postgres + Qdrant via Docker:

```powershell
docker compose -f infra/docker-compose.yml up --build
```

### Frontend

```powershell
cd frontend
npm install
npm run dev
```

`.env.development` already points the frontend at `http://localhost:8000`. Open
<http://localhost:3000> — the landing page shows a live backend status panel.

### Full local stack

Run the backend (port 8000) and the frontend (port 3000) in two terminals. The
backend's `ALLOWED_ORIGINS` already includes `http://localhost:3000` for CORS.

## Production

Production is deployed, not run by hand. Backend and frontend deploy
independently from the same repository.

### Backend (Render)

- Uses `infra/render.yaml` (sets `APP_ENV=production`, disables web search and
  code execution).
- Secrets are set as Render environment variables — never in `render.yaml` or
  Git. See [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
- Local production smoke test:

  ```powershell
  cd backend
  $env:APP_ENV = "production"
  uvicorn app.main:app --host 0.0.0.0 --port 8000
  ```

### Frontend (Vercel)

- Root directory: `frontend`. Build: `npm run build`. Output is served by
  Vercel's Next.js runtime.
- Set `NEXT_PUBLIC_API_BASE_URL` (the Render backend URL) and
  `NEXT_PUBLIC_APP_ENV=production` in the Vercel project's **Production**
  environment variables.
- Add the deployed Vercel URL to the backend's `ALLOWED_ORIGINS` (and remove
  `localhost` from prod CORS).
- Local production build test:

  ```powershell
  cd frontend
  Copy-Item .env.production.example .env.production   # set the real backend URL
  npm run build
  npm run start
  ```

## Environment ↔ branch mapping

See [BRANCHING.md](BRANCHING.md). In short: `develop` → preview/staging,
`main` → production.
