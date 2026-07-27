# Key Setup Guide — Step by Step

How to obtain every value and where to paste it. **All of these go into
`backend/.env` (the real, gitignored file), never into `backend/.env.example`.**

This guide covers the **secret keys you fetch from a provider**. For the
non-secret **settings** (app config, CORS, token lifetimes, models, agent
budgets, feature flags, frontend `NEXT_PUBLIC_*`), see
[CONFIG_REFERENCE.md](CONFIG_REFERENCE.md).

Golden rules:

- `backend/.env.example` = blank placeholders, committed to Git.
- `backend/.env` = your real secrets, gitignored, never committed or pushed.
- Never paste a secret into chat, screenshots, or the frontend.

Quick status of this project's keys:

| Key | Provider | You have it? |
| --- | --- | --- |
| `JWT_SECRET_KEY` | generated locally | ✅ |
| `GEMINI_API_KEY` | Google AI Studio | ✅ |
| `DATABASE_URL` | Neon (Postgres) | ✅ |
| `QDRANT_URL`, `QDRANT_API_KEY` | Qdrant Cloud | ✅ |
| `OBJECT_STORAGE_*` | **Supabase Storage** | ⬜ follow §5 |
| `TAVILY_API_KEY`, `LANGFUSE_*`, `REDIS_URL` | optional | ⬜ only if needed |

---

## 1. `JWT_SECRET_KEY` — generate it yourself

No account needed. It signs login tokens; just needs to be long and random.

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Copy the output into `backend/.env`:

```env
JWT_SECRET_KEY=<paste the generated value>
```

Use a **different** value in production (set it in the Render dashboard).

---

## 2. `GEMINI_API_KEY` — Google AI Studio

1. Go to <https://aistudio.google.com/app/apikey> and sign in with a Google account.
2. Click **Create API key** (choose or create a Google Cloud project if asked).
3. Copy the key (starts with `AI...` / `AQ...`).
4. Paste into `backend/.env`:

   ```env
   GEMINI_API_KEY=<paste key>
   ```

`GEMINI_MODEL` and `GEMINI_EMBEDDING_MODEL` are already set to sensible defaults.

---

## 3. `DATABASE_URL` — Neon (Postgres)

You already have this. To re-fetch or rotate:

1. Go to <https://console.neon.tech> → your project.
2. On the **Dashboard**, find **Connection string** (or **Connect**).
3. Select the **pooled** connection and copy the full string. It looks like:

   ```text
   postgresql://USER:PASSWORD@ep-xxxx-pooler.REGION.aws.neon.tech/neondb?sslmode=require
   ```

4. Paste into `backend/.env` as `DATABASE_URL`.

> **Heads-up for when DB code lands:** the backend uses SQLAlchemy + psycopg 3,
> which expects the scheme `postgresql+psycopg://…`. When you wire up the
> database, change the leading `postgresql://` to `postgresql+psycopg://` (keep
> the rest, including `?sslmode=require`). It doesn't matter yet — right now
> `/readyz` only checks that the value is present.

---

## 4. `QDRANT_URL` + `QDRANT_API_KEY` — Qdrant Cloud

You already have these. To re-fetch:

1. Go to <https://cloud.qdrant.io> → your cluster.
2. **Cluster URL** (the `https://….cloud.qdrant.io` value) → `QDRANT_URL`.
3. **API Keys** → **Create** (or copy existing) → `QDRANT_API_KEY`.
4. Paste both into `backend/.env`. Leave `QDRANT_COLLECTION=analyst_documents`.

---

## 5. `OBJECT_STORAGE_*` — Supabase Storage (S3-compatible)  ← you still need this

You chose Supabase for storage. Its Storage is S3-compatible, which fits the
backend's S3 adapter. You'll collect **5** values.

### 5a. Create the project and bucket

1. Go to <https://supabase.com/dashboard> and sign in → **New project**.
   - Pick an organization, a name, a database password, and a **Region**.
   - **Write the region down** — you'll need it below.
2. In the left sidebar open **Storage** → **New bucket**.
   - Name it `analyst-documents`.
   - Keep it **Private** (do *not* make it public).
   - Click **Create bucket**. → this name is `OBJECT_STORAGE_BUCKET`.

### 5b. Get the endpoint and region

1. Open the S3 configuration page: **Storage** (sidebar) → **Settings**, or go
   directly to `https://supabase.com/dashboard/project/_/storage/s3`
   (`_` auto-selects your current project).
2. Copy the two values shown there:
   - **Endpoint** → `OBJECT_STORAGE_ENDPOINT`. Format:

     ```text
     https://<project_ref>.storage.supabase.co/storage/v1/s3
     ```

     (`<project_ref>` is your project's ID, visible in the dashboard URL.)
   - **Region** → `OBJECT_STORAGE_REGION` (e.g. `ap-southeast-1`, `us-east-1`).
     Replace the current `auto` with this exact value.

### 5c. Create the S3 access keys

1. On that same S3 configuration page, click **New access key** (name it e.g.
   `analyst-backend`).
2. Supabase shows the pair **once** — copy both immediately:
   - **Access key ID** → `OBJECT_STORAGE_ACCESS_KEY_ID`
   - **Secret access key** → `OBJECT_STORAGE_SECRET_ACCESS_KEY`
3. If you lose the secret, delete the key and create a new one.

### 5d. Fill `backend/.env`

```env
OBJECT_STORAGE_BUCKET=analyst-documents
OBJECT_STORAGE_ENDPOINT=https://<project_ref>.storage.supabase.co/storage/v1/s3
OBJECT_STORAGE_REGION=<your project region>
OBJECT_STORAGE_ACCESS_KEY_ID=<access key id>
OBJECT_STORAGE_SECRET_ACCESS_KEY=<secret access key>
```

> Note: Supabase's S3 endpoint requires **path-style** addressing. The backend's
> S3 client will be configured with `forcePathStyle`/`path` addressing when the
> upload feature is implemented — no action needed from you now.

---

## 6. Optional keys

These are **not needed to run the pilot**. Add each only when you turn on its
feature. Leave them blank otherwise.

### 6a. `TAVILY_API_KEY` — web search (only if `ENABLE_WEB_SEARCH=true`)

Tavily is the web-search provider. The free tier gives 1,000 credits/month, no
card required.

1. Go to <https://app.tavily.com> and sign up / sign in (Google, GitHub, or email).
2. Your API key is shown on the dashboard home. It starts with `tvly-`.
3. Copy it into `backend/.env`:

   ```env
   TAVILY_API_KEY=tvly-...
   ```

4. Web search stays off until you also set `ENABLE_WEB_SEARCH=true` — and only
   do that after the URL-validation/sanitisation controls exist (see
   IMPLEMENTATION_SCOPE.md).

### 6b. `LANGFUSE_PUBLIC_KEY` + `LANGFUSE_SECRET_KEY` — tracing (optional)

Langfuse records agent traces for debugging/observability. Two keys plus a host.

1. Pick a **data region** and sign up (they're fully separate accounts):
   - EU → <https://cloud.langfuse.com> (host `https://cloud.langfuse.com`)
   - US → <https://us.cloud.langfuse.com> (host `https://us.cloud.langfuse.com`)
2. Create an **Organization**, then a **Project** (keys are also generated on
   project creation).
3. Open **Project → Settings → API Keys → Create new API key**. It shows the
   pair — the **secret is revealed once**, copy both now:
   - Public key `pk-lf-...` → `LANGFUSE_PUBLIC_KEY`
   - Secret key `sk-lf-...` → `LANGFUSE_SECRET_KEY`
4. Set `LANGFUSE_BASE_URL` to **match the region you chose** in step 1:

   ```env
   LANGFUSE_PUBLIC_KEY=pk-lf-...
   LANGFUSE_SECRET_KEY=sk-lf-...
   LANGFUSE_BASE_URL=https://cloud.langfuse.com   # or https://us.cloud.langfuse.com
   ```

   > A key from the EU region will not work against the US host, and vice versa.

### 6c. `REDIS_URL` — persistent job queue (only when added)

The backend uses external services for state (no local disk). When a durable
async queue is introduced, point it at a hosted Redis. Upstash has a free tier.

1. Go to <https://console.upstash.com> → sign up → **Redis** tab → **+ Create Database**.
2. Name it, choose a **Primary Region** close to the backend (Render), create it.
3. Open the database → **Details** tab. Copy the **Redis protocol (TLS)**
   connection string — the one starting with `rediss://` (encrypted). Do **not**
   use the REST URL. It looks like:

   ```text
   rediss://default:<password>@<endpoint>.upstash.io:6379
   ```

4. Paste into `backend/.env`:

   ```env
   REDIS_URL=rediss://default:<password>@<endpoint>.upstash.io:6379
   ```

Sources for these providers: [Tavily quickstart](https://docs.tavily.com/documentation/quickstart),
[Langfuse data regions](https://langfuse.com/security/data-regions),
[Upstash Redis get started](https://upstash.com/docs/redis/overall/getstarted).

---

## 7. Verify

After editing `backend/.env`, restart the backend and check readiness:

```powershell
cd backend
.\.venv\Scripts\Activate.ps1
uvicorn app.main:app --reload --port 8000
```

Open <http://localhost:8000/readyz>. Each configured integration flips to `true`.
The frontend landing page (`npm run dev`, <http://localhost:3000>) shows the same
status live.

## Production

For the deployed pilot, put these same values in the **Render** dashboard
(backend) — not in Git. Use a fresh `JWT_SECRET_KEY` for production. See
[DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
