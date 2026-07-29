# Multi-Agent AI Analyst

A multi-agent analyst with a custom FastAPI backend and a Next.js frontend.

## Ownership

- **Backend** — custom FastAPI service and background worker: API, auth, agents,
  data, ingestion, deployment. (see [`backend/`](backend/))
- **Frontend** — **owned and implemented by Claude**: the Next.js browser UI
  that consumes the backend's OpenAPI + SSE contract. (see [`frontend/`](frontend/))

The frontend never holds provider, database, or model secrets — it only calls
the backend API.

## What it does

Readers sign up with an email and password, upload documents, and ask questions.
A supervisor graph routes each question across retrieval, optional web research,
and optional analytics, then answers with citations back to the evidence.

Registration is one step: no confirmation email, no waiting. The address is not
used to authenticate anything, so an emailed round trip would add a way to fail
without adding a guarantee — and it would make an email provider a hard
dependency for a product that otherwise needs none.

## Architecture

One service is enough to run everything. The API accepts a request, writes a
durable row, queues the work, and returns; an embedded worker executes it.

The work is queued rather than done inline because that seam is what lets it
move. Set `REDIS_URL` and deploy the worker service, and execution leaves the
API process with no code change — PostgreSQL already holds the record of what
still needs doing, and the worker re-enqueues anything a restart stranded. Until
then the seam costs nothing and the deployment stays a single service.

Everything a reader creates belongs to an organization, and every query is
filtered by the organization on their verified access token.

- Self-service registration that signs you straight in, optional password reset
  when an SMTP provider is configured, and invitations for adding people to an
  existing workspace.
- Durable runs: an answer survives a restart, and a reader who closes the tab
  can rejoin an in-flight run from any device.
- Server-sent progress replayed from stored events, so a reconnect resumes
  exactly rather than replaying.
- Rate limits on every credential and token endpoint, plus a per-workspace
  daily analysis quota.
- Bounded document parsing: archive expansion, member counts, page and sheet
  counts, and extracted characters are all capped, off the request path.
- Strictly isolated `development` / `test` / `production` configuration: each
  mode loads exactly one env file (never layered), development refuses remote
  service endpoints, and production refuses to start on an incomplete config.
- Dependency management, tests, linting, Docker, GitHub Actions, and a Render
  deployment blueprint.

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

**No Redis needed.** With `REDIS_URL` empty the API starts an embedded worker
and an in-memory queue, so one command runs the whole product — locally and in a
small deployment alike. Set `REDIS_URL` to move execution to its own process,
and run the worker alongside the API:

```powershell
python -m app.worker
```

**No email provider needed.** Signing up and signing in never send email. The
only flow that does is self-service password reset, which is unavailable — and
hidden in the UI — unless `EMAIL_SENDER=smtp` and an SMTP host are configured.
Locally, `EMAIL_SENDER=console` writes the reset link to the backend log.

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
- [Pre-deployment and shipping readiness plan](docs/PRE_DEPLOYMENT_AND_SHIPPING.md)
- [Implementation scope](docs/IMPLEMENTATION_SCOPE.md)
- [Frontend README](frontend/README.md)

Read these before deploying.
