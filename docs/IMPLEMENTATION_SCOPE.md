# Multi-Agent AI Analyst — Implementation Scope

## Ownership

The project will be built as a custom application. The backend implementation owner is responsible for every server-side and platform component below. **Claude owns the frontend** — the browser UI, its components, styling, and integration against the documented API.

| Area | Owner | Notes |
| --- | --- | --- |
| Frontend UI, pages, components, styling | Claude | Consumes the documented API and streaming events. |
| Public API, authentication, authorization, and rate limits | Backend | Custom FastAPI implementation; no backend-as-a-service application logic. |
| Agent graph, prompts, model integration, retrieval, SQL, evaluation | Backend | Custom LangGraph application and tool adapters. |
| Data model, migrations, row-level authorization, audit trail | Backend | Schema and migrations are source-controlled. |
| Document ingestion, chunking, embeddings, vector indexing | Backend | Runs as an asynchronous backend workload. |
| Deployment definitions, CI/CD, monitoring, runbooks | Backend | Infrastructure configuration is kept in this repository. |
| Managed hosting, database, vector database, model provider | Infrastructure services | Used as infrastructure only; application logic remains custom code. |

## Product Boundary

The first deployable release is a **free public or private pilot**, not an SLA-backed commercial production service. The code, security boundaries, observability, and deployment process are production-shaped so that the infrastructure can be upgraded without a rewrite.

The first release includes:

1. Tenant-aware document ingestion and retrieval with source citations.
2. A custom FastAPI API with JWT authentication, authorization checks, quotas, and server-sent event streaming.
3. A LangGraph supervisor routing to retrieval, safe read-only SQL, or both.
4. Persisted conversations, runs, feedback, source metadata, and audit events.
5. Evaluation tests, traces, health checks, CI, and deployment documentation.

The first release explicitly excludes:

- Arbitrary model-written Python execution.
- Direct access to a company production database.
- Unrestricted open-web browsing.
- Client-side access to provider, database, or vector-store secrets.

Web search can be enabled after URL validation, content sanitisation, timeout, and citation controls are tested. A code agent can be enabled only after a separate, locked-down execution sandbox exists.

## Intended Repository Layout

```text
multi-agent-ai-analyst/
├── backend/
│   ├── app/
│   │   ├── api/              # HTTP and SSE endpoints
│   │   ├── agents/           # LangGraph state, nodes, prompts, tools
│   │   ├── auth/             # JWT, password hashing, authorization
│   │   ├── db/               # SQLAlchemy models, repositories, migrations
│   │   ├── ingestion/        # Parsing, chunking, embedding, indexing
│   │   ├── services/         # Gemini, Qdrant, storage, observability adapters
│   │   └── workers/          # Long-running ingestion and evaluation jobs
│   ├── tests/
│   ├── Dockerfile
│   └── pyproject.toml
├── frontend/                 # Owned and implemented by Claude (Next.js)
├── database/
│   ├── migrations/
│   └── seed/
├── infra/
│   ├── render.yaml
│   ├── docker-compose.yml
│   └── github-actions/
├── docs/
│   ├── IMPLEMENTATION_SCOPE.md
│   ├── API_CONTRACT.md
│   ├── DEPLOYMENT_RUNBOOK.md
│   └── SECURITY_MODEL.md
└── README.md
```

## Custom Backend Architecture

```text
Frontend (owned by Claude)
       │ HTTPS + JWT + SSE
       ▼
Custom FastAPI API
       ├── authentication, authorization, quotas, validation
       ├── conversation/run API and source retrieval API
       └── async job dispatch
                 │
                 ▼
       Custom agent worker (LangGraph)
       ├── supervisor and evidence-based answer generator
       ├── retrieval tool
       ├── read-only SQL tool
       └── critic and evaluation hooks
          │              │                 │
          ▼              ▼                 ▼
     PostgreSQL       Qdrant          Gemini API
     application DB   vectors         LLM + embeddings
```

Managed services are replaceable adapters, not the application backend:

- **PostgreSQL:** stores application data. The backend owns the schema, migrations, authentication records, permissions, and queries. A free hosted PostgreSQL provider may be used initially.
- **Object storage:** stores original uploads. The backend controls upload authorisation and creates signed/limited access paths.
- **Qdrant Cloud:** stores embeddings only. Every query receives a server-enforced tenant and access-control filter.
- **Gemini:** supplies LLM and embedding calls through a server-only adapter.
- **Render and Vercel:** host independently deployable backend and frontend applications from the same repository.

## API Contract for the Frontend

The backend will publish a versioned OpenAPI contract. Claude's frontend consumes it and must not call databases, Qdrant, Gemini, or storage providers directly.

Initial endpoints:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/v1/auth/register` | Create a local account. |
| `POST` | `/v1/auth/login` | Obtain a short-lived access token and refresh token. |
| `POST` | `/v1/documents` | Upload an authorised document. |
| `GET` | `/v1/documents/{id}` | Read document/indexing status. |
| `POST` | `/v1/conversations` | Create a conversation. |
| `POST` | `/v1/conversations/{id}/runs` | Start an analyst run. |
| `GET` | `/v1/runs/{id}/events` | Receive typed SSE status events. |
| `GET` | `/v1/runs/{id}` | Retrieve final answer, citations, and safe metadata. |
| `POST` | `/v1/runs/{id}/feedback` | Submit user feedback. |
| `GET` | `/healthz` | Liveness check. |
| `GET` | `/readyz` | Dependency readiness check. |

SSE events are limited to safe, typed progress updates such as `run_started`, `routing`, `retrieving`, `querying`, `generating`, `completed`, and `failed`. They do not expose raw model reasoning, secret values, or full internal traces.

## Data and Security Requirements

- The application uses its own `users`, `organizations`, `memberships`, `documents`, `conversations`, `runs`, `citations`, and `audit_events` tables.
- Passwords are hashed with a modern password-hashing library; never stored in plaintext.
- JWT signing keys, Gemini keys, Qdrant keys, and storage/database credentials exist only in local `.env` files and deployment secret settings. They are never committed or sent through chat.
- All user input, retrieved documents, and web content are treated as untrusted data.
- SQL is issued only to an analytics replica or approved views via a read-only credential. It is parsed and allow-listed, limited to one statement, and subject to timeout, row, and cost limits.
- Agent runs have maximum step, tool-call, wall-clock, token, and cost budgets.
- Each vector point and query includes a tenant/access filter controlled by the backend, not by the client.
- Logs and traces redact credentials and sensitive user content according to a defined retention policy.

## Free Pilot Infrastructure

| Component | Initial service | Free-pilot constraint |
| --- | --- | --- |
| Source control and CI | GitHub | Keep the repository private; no secrets in Git. |
| Frontend hosting | Vercel Hobby | Personal/non-commercial usage limits. |
| Backend hosting | Render Free | Can cold-start after inactivity; no persistent local filesystem. |
| PostgreSQL / initial object storage | Supabase Free or another hosted PostgreSQL provider | The backend owns all application logic; free instances may pause and lack backups. |
| Vector search | Qdrant Cloud Free | Single node; not highly available. |
| LLM and embeddings | Gemini API | Subject to provider quotas and availability. |
| Tracing | Langfuse Cloud | Optional; redact sensitive data. |

The API and worker must never depend on local disk persistence. Files, database state, vector indexes, and run checkpoints are externalised.

## Delivery Order

1. Create the repository and protect `main`; add `.gitignore`, secret scanning, CI, and environment templates.
2. Scaffold the custom FastAPI service, Docker setup, configuration validation, health endpoints, and database migrations.
3. Implement local authentication, organizations/memberships, audit events, and API authorization.
4. Build document upload, asynchronous ingestion, Qdrant indexing, tenant-safe retrieval, and citations.
5. Build the SQL analytics adapter with safe approved views and test cases.
6. Build the LangGraph state machine: structured router, evidence collection, answer generation, critic, budgets, retries, and persisted run state.
7. Publish OpenAPI and SSE contracts for the frontend; integration occurs only through these APIs.
8. Add evaluation datasets for routing, retrieval, SQL correctness, grounded answers, and prompt-injection resistance.
9. Add tracing, metrics, alerts, backups/export procedures, and incident/rollback runbooks.
10. Deploy backend to staging, integrate the frontend, perform smoke tests, then conduct a limited pilot rollout.

## Required Inputs Before Implementation

The project owner provides:

1. An empty private personal GitHub repository URL.
2. The product name and a decision: public pilot or private pilot.
3. Safe demo documents and either synthetic analytics data or an approved anonymised dataset.
4. Confirmation of the chosen free-service accounts: Gemini, Qdrant, database provider, Render, and Vercel.
5. A decision on login policy: email/password for the pilot, or invite-only accounts.

The project owner must not provide API keys, passwords, access tokens, or database credentials in chat. Secret values are entered directly into the isolated, gitignored mode files (`backend/.env.development` or `backend/.env.production`) and service dashboards, using the matching committed `.example` template as the starting point. Development and production files are never layered.
