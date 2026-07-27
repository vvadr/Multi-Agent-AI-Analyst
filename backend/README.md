# Backend

This directory contains the custom API, agent orchestration, ingestion workers, database access layer, and deployment definitions. It deliberately contains no browser UI.

Configuration is mode-based (`APP_ENV` selects the file):

- **Development** (default) → `.env.development` (local Docker services). Copy it from `.env.development.example`.
- **Production** → `.env.production` (connected services) or host dashboard vars. Template: `.env.production.example`.
- `.env.example` is the full annotated reference of every variable.

The `/healthz` endpoint starts without external services; `/readyz` reports
which integrations have been configured. See [../docs/ENVIRONMENTS.md](../docs/ENVIRONMENTS.md)
for the full dev/prod split and [../docs/CONFIG_REFERENCE.md](../docs/CONFIG_REFERENCE.md)
for every variable.
