# Local Demo API Contract

These endpoints are available only when `APP_ENV=development` and
`ENABLE_UNAUTHENTICATED_DEMO_API=true`. They use the server-owned `demo` tenant,
keep runs in process memory, and must never be enabled in production.

## Documents

`POST /v1/documents` accepts multipart form field `file` no larger than
`DEMO_MAX_UPLOAD_BYTES` (10 MB by default). It safely extracts and indexes
PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, and HTML. Password-protected
PDFs and legacy binary Office formats are rejected rather than being parsed by
an unsafe converter. The original is stored in the configured object store.

```json
{"id":"uuid","filename":"report.txt","chunks":3}
```

## Runs

`POST /v1/runs` accepts `{"question":"..."}` and returns HTTP 202:

```json
{"id":"uuid","status":"queued"}
```

`GET /v1/runs/{id}` returns queued, running, completed, or failed status. A
completed result includes the grounded answer and safe citation metadata.

`GET /v1/runs/{id}/events` is a Server-Sent Event stream. Event names are
`run_started`, `routing`, `retrieving`, `querying`, `generating`, `completed`,
and `failed`. Events never contain raw prompts, provider errors, secrets, or
model reasoning.

## Deliberate limits

- The local demo supports text uploads only and has no authentication,
  persistence, run history, or tenant selection.
- The graph can use retrieval, optional Tavily web search, and the synthetic
  `analytics.monthly_metrics` SQL source.
- Completed question/answer pairs are kept in a separate tenant-filtered memory
  collection and recalled for follow-up questions. Use `python -m
  app.evaluation.cli` to run the ten-case Phase 4 evaluation dataset.
- Model-written Python execution remains disabled until a separately deployed,
  locked-down sandbox exists.
