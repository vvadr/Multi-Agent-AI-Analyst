import threading
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_job_queue
from app.api.router import api_router, versioned_api_router
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.middleware.request_id import RequestIdMiddleware

logger = structlog.get_logger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run an embedded worker when there is no external queue to hand work to.

    Without `REDIS_URL` the whole product runs in one process: a developer needs
    no infrastructure, and a small deployment needs no second service. Runs and
    documents are still durable rows, and the worker's startup sweep still
    recovers anything a restart stranded — what is lost is the ability to scale
    the web tier, since each instance would then execute its own work.

    Setting `REDIS_URL` moves execution to the separate worker service and this
    branch goes quiet.
    """
    settings = get_settings()
    worker = _start_embedded_worker(settings)
    try:
        yield
    finally:
        if worker:
            worker.stop()


def _start_embedded_worker(settings: Settings):
    if settings.redis_url or settings.app_env == "test":
        return None
    from app.worker import Worker

    worker = Worker(settings, get_job_queue())
    thread = threading.Thread(target=worker.run_forever, name="embedded-worker", daemon=True)
    thread.start()
    logger.info("embedded_worker_started", reason="no REDIS_URL configured")
    return worker


def create_app() -> FastAPI:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.app_env == "production")

    app = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.app_env != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(RequestIdMiddleware)
    app.include_router(api_router)
    app.include_router(versioned_api_router, prefix=settings.api_v1_prefix)
    logger.info("application_configured", app_env=settings.app_env)
    return app


app = create_app()
