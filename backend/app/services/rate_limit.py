"""Fixed-window request limiting.

Applied to the endpoints where repetition is the attack: credential guessing on
login, invite and reset token guessing, signup floods, and run/upload abuse by
an authenticated account.

The window is fixed rather than sliding. A sliding log is more precise, but the
imprecision here is bounded at one extra window's worth of attempts, which is
irrelevant against the thing this is defending — and a fixed window costs one
atomic INCR instead of a sorted set per caller.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass

import structlog
from fastapi import HTTPException, Request, status

from app.core.config import Settings

logger = structlog.get_logger(__name__)

_KEY_PREFIX = "analyst:rate"


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    retry_after_seconds: int


class InMemoryRateLimiter:
    """Process-local limiter for development and tests."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._counters: dict[str, tuple[int, float]] = {}

    def check(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        now = time.time()
        with self._lock:
            count, expires_at = self._counters.get(key, (0, now + window_seconds))
            if now >= expires_at:
                count, expires_at = 0, now + window_seconds
            count += 1
            self._counters[key] = (count, expires_at)
            if count > limit:
                return RateLimitResult(False, max(1, int(expires_at - now)))
            return RateLimitResult(True, 0)

    def reset(self) -> None:
        with self._lock:
            self._counters.clear()


class RedisRateLimiter:
    def __init__(self, settings: Settings) -> None:
        if not settings.redis_url:
            raise ValueError("REDIS_URL is required for distributed rate limiting")
        import redis

        self._client = redis.Redis.from_url(
            settings.redis_url.get_secret_value(),
            decode_responses=True,
            socket_timeout=settings.service_probe_timeout_seconds,
            socket_connect_timeout=settings.service_probe_timeout_seconds,
        )

    def check(self, key: str, *, limit: int, window_seconds: int) -> RateLimitResult:
        namespaced = f"{_KEY_PREFIX}:{key}"
        try:
            pipe = self._client.pipeline()
            pipe.incr(namespaced)
            pipe.ttl(namespaced)
            count, ttl = pipe.execute()
            if ttl < 0:
                # First hit in this window, or a key that lost its expiry.
                self._client.expire(namespaced, window_seconds)
                ttl = window_seconds
        except Exception:
            # Failing open is the deliberate choice: a Redis outage must not
            # take sign-in down. The tradeoff is logged so it is visible.
            logger.warning("rate_limit_backend_unavailable", key=key)
            return RateLimitResult(True, 0)
        if count > limit:
            return RateLimitResult(False, max(1, int(ttl)))
        return RateLimitResult(True, 0)


def build_rate_limiter(settings: Settings) -> RedisRateLimiter | InMemoryRateLimiter:
    if settings.redis_url:
        return RedisRateLimiter(settings)
    return InMemoryRateLimiter()


def client_identifier(request: Request) -> str:
    """Best available caller identity for limiting.

    Render terminates TLS and sets `X-Forwarded-For`, so its first entry is the
    real client. It is spoofable by anything that can reach the app directly,
    which is why limits that protect an account (rather than the edge) are keyed
    on the account instead.
    """
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "unknown"


def enforce(
    limiter: RedisRateLimiter | InMemoryRateLimiter,
    *,
    settings: Settings,
    key: str,
    limit: int,
    window_seconds: int,
) -> None:
    """Raise 429 with `Retry-After` when the caller is over its allowance."""
    if not settings.rate_limit_enabled:
        return
    result = limiter.check(key, limit=limit, window_seconds=window_seconds)
    if result.allowed:
        return
    raise HTTPException(
        status_code=status.HTTP_429_TOO_MANY_REQUESTS,
        detail="Too many requests. Try again shortly.",
        headers={"Retry-After": str(result.retry_after_seconds)},
    )
