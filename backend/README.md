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

## Phase 1 document foundation

`app.agents.state.AgentState` is the single contract for the later agent graph.
`app.ingestion.DocumentIngestionService` accepts trusted, already-authorized
text from a backend job, splits it into overlapping chunks, embeds those chunks,
and indexes them in Qdrant. Searches always include a server-controlled tenant
filter. The first public upload endpoint is deliberately deferred until the
authentication and authorization phase, so this foundation does not create an
unauthenticated document API.

The embedding dimension is explicit (`EMBEDDING_DIMENSIONS=768`) and must stay
aligned with the Qdrant collection. Change it only with a new collection or a
planned re-index.

With the local services running and the model key configured, the foundation
can be proved end-to-end with a plain-text document:

```powershell
python -m app.ingestion.cli .\sample.txt --tenant-id demo --document-id sample-001
```

## Phase 2 specialist-agent foundation

The retriever and Tavily web-search agents run independently against the shared
state. Web results are treated as untrusted reference content. The SQL agent is
disabled by default and accepts only one bounded `SELECT` from the approved
`analytics.monthly_metrics` source. Enable it only with an explicit
`ANALYTICS_DATABASE_URL` that uses a dedicated read-only database role.

Until authenticated run endpoints are added, each specialist can be exercised
independently from the command line. For example:

```powershell
python -m app.agents.phase_two_cli web "What changed in AI regulation this week?"
python -m app.agents.phase_two_cli retrieve "What were the sustainability priorities?" --tenant-id demo
```

## Phase 3 local demo

Phase 3 adds the bounded LangGraph supervisor, grounded answer generation, and
critic. In development only, set `ENABLE_UNAUTHENTICATED_DEMO_API=true` to use
the fixed `demo` tenant with `POST /v1/documents`, `POST /v1/runs`, and the
SSE endpoint `GET /v1/runs/{id}/events`. These runs are process-local and must
not be exposed in production. Apply migrations before using the synthetic SQL
demo data:

```powershell
alembic upgrade head
```

The graph enforces run, step, and revision bounds. It deliberately does not
execute model-written Python; that feature requires a separate sandbox.
