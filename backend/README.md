# Backend

This directory contains the custom API, agent orchestration, ingestion workers, database access layer, and deployment definitions. It deliberately contains no browser UI.

Copy `.env.example` to `.env` and set only the values needed for the component you are currently working on. The `/healthz` endpoint starts without external services; `/readyz` reports which integrations have been configured.
