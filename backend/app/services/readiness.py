from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from math import ceil
from typing import TypedDict

import httpx
import structlog
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, text

from app.core.config import Settings

logger = structlog.get_logger(__name__)


class ComponentReadiness(TypedDict):
    configured: bool
    reachable: bool


def _probe_database(settings: Settings) -> None:
    if not settings.database_url:
        raise RuntimeError("database is not configured")
    dsn = settings.database_url.get_secret_value()
    # `connect_timeout` is a libpq option. SQLite — used as the zero-install
    # local stand-in in development — rejects it, so only send it to Postgres.
    connect_args = (
        {}
        if dsn.startswith("sqlite")
        else {"connect_timeout": max(1, ceil(settings.service_probe_timeout_seconds))}
    )
    engine = create_engine(dsn, pool_pre_ping=True, connect_args=connect_args)
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    finally:
        engine.dispose()


def _probe_qdrant(settings: Settings) -> None:
    if not settings.qdrant_url or not settings.qdrant_api_key:
        raise RuntimeError("qdrant is not configured")
    client = QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key.get_secret_value(),
        prefer_grpc=settings.qdrant_prefer_grpc,
        timeout=settings.service_probe_timeout_seconds,
    )
    try:
        client.get_collections()
    finally:
        client.close()


def _probe_object_storage(settings: Settings) -> None:
    if (
        not settings.object_storage_endpoint
        or not settings.object_storage_access_key_id
        or not settings.object_storage_secret_access_key
    ):
        raise RuntimeError("object storage is not configured")

    import boto3
    from botocore.config import Config as BotoConfig

    client = boto3.client(
        "s3",
        endpoint_url=settings.object_storage_endpoint,
        region_name=settings.object_storage_region,
        aws_access_key_id=settings.object_storage_access_key_id.get_secret_value(),
        aws_secret_access_key=settings.object_storage_secret_access_key.get_secret_value(),
        config=BotoConfig(
            connect_timeout=settings.service_probe_timeout_seconds,
            read_timeout=settings.service_probe_timeout_seconds,
            retries={"max_attempts": 0},
            s3={"addressing_style": "path"},
        ),
    )
    client.head_bucket(Bucket=settings.object_storage_bucket)


def _probe_model(settings: Settings) -> None:
    timeout = httpx.Timeout(settings.service_probe_timeout_seconds)
    if settings.use_model_gateway:
        if not settings.litellm_base_url or not settings.litellm_master_key:
            raise RuntimeError("model gateway is not configured")
        response = httpx.get(
            f"{settings.litellm_base_url.rstrip('/')}/health/liveliness",
            headers={
                "Authorization": (
                    f"Bearer {settings.litellm_master_key.get_secret_value()}"
                )
            },
            timeout=timeout,
        )
    else:
        if not settings.gemini_api_key:
            raise RuntimeError("Gemini is not configured")
        response = httpx.get(
            (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{settings.gemini_model}"
            ),
            headers={"x-goog-api-key": settings.gemini_api_key.get_secret_value()},
            timeout=timeout,
        )
    response.raise_for_status()


_PROBES: dict[str, Callable[[Settings], None]] = {
    "database": _probe_database,
    "model": _probe_model,
    "qdrant": _probe_qdrant,
    "object_storage": _probe_object_storage,
}


def _configured_components(settings: Settings) -> dict[str, bool]:
    model_configured = bool(
        (
            settings.litellm_base_url
            and settings.litellm_master_key
        )
        if settings.use_model_gateway
        else settings.gemini_api_key
    )
    return {
        "database": bool(settings.database_url),
        "model": model_configured,
        "qdrant": bool(settings.qdrant_url and settings.qdrant_api_key),
        "object_storage": bool(
            settings.object_storage_endpoint
            and settings.object_storage_access_key_id
            and settings.object_storage_secret_access_key
        ),
    }


def check_readiness(settings: Settings) -> dict[str, ComponentReadiness]:
    configured = _configured_components(settings)
    results: dict[str, ComponentReadiness] = {
        name: {"configured": value, "reachable": False}
        for name, value in configured.items()
    }

    with ThreadPoolExecutor(max_workers=len(_PROBES)) as executor:
        future_to_name = {
            executor.submit(_PROBES[name], settings): name
            for name, is_configured in configured.items()
            if is_configured
        }
        for future in as_completed(future_to_name):
            name = future_to_name[future]
            try:
                future.result()
            except Exception as exc:
                logger.warning(
                    "readiness_probe_failed",
                    component=name,
                    error_type=type(exc).__name__,
                )
            else:
                results[name]["reachable"] = True

    return results
