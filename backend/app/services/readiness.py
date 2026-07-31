import threading
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from math import ceil
from time import monotonic
from typing import TypedDict

import httpx
import structlog
from qdrant_client import QdrantClient
from sqlalchemy import create_engine, text

from app.core.config import Settings

logger = structlog.get_logger(__name__)

_MODEL_PROBE_TIMEOUT_SECONDS = 10.0
_MODEL_PROBE_PROMPT = "ping"
# Long enough that refreshing the status card cannot become a spend, short
# enough that a restored account shows green without a redeploy.
_MODEL_PROBE_CACHE_SECONDS = 30.0


class ComponentReadiness(TypedDict):
    configured: bool
    reachable: bool


class _ProbeOk:
    """Sentinel for a cached success, so `None` can still mean "not cached"."""


_PROBE_OK = _ProbeOk()


class _ModelProbeCache:
    """Remembers the last verdict, success or failure, for a short window.

    The lock is held across the call in `_probe_model` by way of `get`/`set`
    being cheap: concurrent readiness requests each make their own call only
    when the window has lapsed, which is a bounded and acceptable overlap.
    """

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._expires_at = 0.0
        self._verdict: _ProbeOk | Exception | None = None

    def get(self) -> _ProbeOk | Exception | None:
        with self._lock:
            if self._verdict is None or monotonic() >= self._expires_at:
                return None
            return self._verdict

    def set(self, verdict: _ProbeOk | Exception) -> None:
        with self._lock:
            self._verdict = verdict
            self._expires_at = monotonic() + _MODEL_PROBE_CACHE_SECONDS

    def clear(self) -> None:
        with self._lock:
            self._verdict = None
            self._expires_at = 0.0


_model_probe_cache = _ModelProbeCache()


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
    """Report the model ready only if it will actually generate.

    Reading a model's metadata, or asking the gateway whether it is alive,
    costs nothing and is answered for an account that cannot generate a single
    token: depleted credits, a revoked key, and a deleted project all return a
    cheerful 200 to those endpoints. A probe that cannot tell that apart
    reports a healthy product while every question fails, which is the one
    outcome it exists to prevent — so this spends one token to find out.

    The result is cached because `/readyz` is unauthenticated: without this,
    anyone who can reach the API could bill the account by refreshing.
    """
    cached = _model_probe_cache.get()
    if cached is not None:
        if cached is not _PROBE_OK:
            raise cached
        return
    try:
        _call_model(settings)
    except Exception as error:
        _model_probe_cache.set(error)
        raise
    _model_probe_cache.set(_PROBE_OK)


def _call_model(settings: Settings) -> None:
    """Ask for a single token over whichever model path is configured."""
    # A generation round-trip is not a socket check — it carries provider
    # queueing and decode time — so it gets a floor above the connect budget.
    timeout = httpx.Timeout(
        max(settings.service_probe_timeout_seconds, _MODEL_PROBE_TIMEOUT_SECONDS)
    )
    if settings.use_model_gateway:
        if not settings.litellm_base_url or not settings.litellm_master_key:
            raise RuntimeError("model gateway is not configured")
        # Chat completions rather than /health/liveliness: the proxy being up
        # says nothing about the Google credentials it holds.
        response = httpx.post(
            f"{settings.litellm_base_url.rstrip('/')}/v1/chat/completions",
            headers={
                "Authorization": (
                    f"Bearer {settings.litellm_master_key.get_secret_value()}"
                )
            },
            json={
                "model": settings.litellm_model,
                "messages": [{"role": "user", "content": _MODEL_PROBE_PROMPT}],
                "max_tokens": 1,
                "temperature": 0,
            },
            timeout=timeout,
        )
    else:
        if not settings.gemini_api_key:
            raise RuntimeError("Gemini is not configured")
        response = httpx.post(
            (
                "https://generativelanguage.googleapis.com/v1beta/models/"
                f"{settings.gemini_model}:generateContent"
            ),
            headers={"x-goog-api-key": settings.gemini_api_key.get_secret_value()},
            json={
                "contents": [{"parts": [{"text": _MODEL_PROBE_PROMPT}]}],
                "generationConfig": {"temperature": 0, "maxOutputTokens": 1},
            },
            timeout=timeout,
        )
    # The generated token is discarded; only the provider's verdict matters.
    response.raise_for_status()


def _probe_queue(settings: Settings) -> None:
    if not settings.redis_url:
        # No Redis means the API runs an embedded worker over an in-process
        # queue. There is nothing to reach, and it cannot be unreachable.
        return
    import redis

    client = redis.Redis.from_url(
        settings.redis_url.get_secret_value(),
        socket_timeout=settings.service_probe_timeout_seconds,
        socket_connect_timeout=settings.service_probe_timeout_seconds,
    )
    try:
        client.ping()
    finally:
        client.close()


_PROBES: dict[str, Callable[[Settings], None]] = {
    "database": _probe_database,
    "model": _probe_model,
    "qdrant": _probe_qdrant,
    "object_storage": _probe_object_storage,
    # Uploads and runs are queued, so an unreachable queue means the product
    # accepts work it cannot execute — that is not "ready".
    "queue": _probe_queue,
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
        # Always configured: either Redis is set, or the in-process queue is.
        "queue": True,
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
