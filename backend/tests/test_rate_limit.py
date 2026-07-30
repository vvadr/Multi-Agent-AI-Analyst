"""Rate limiting: the allowance, the refusal, and what happens when Redis is down."""

from __future__ import annotations

import pytest
from fastapi import HTTPException, Request

from app.core.config import Settings
from app.services.rate_limit import (
    InMemoryRateLimiter,
    RedisRateLimiter,
    build_rate_limiter,
    client_identifier,
    enforce,
    rate_limit_key,
)
from tests.test_queue import FakeRedis


def _request(headers: dict[str, str] | None = None, client_host: str = "10.0.0.1") -> Request:
    raw = [(key.lower().encode(), value.encode()) for key, value in (headers or {}).items()]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": raw,
            "client": (client_host, 1234),
        }
    )


def _redis_limiter(client: FakeRedis) -> RedisRateLimiter:
    limiter = RedisRateLimiter.__new__(RedisRateLimiter)
    limiter._client = client
    return limiter


# ------------------------------------------------------------- in-memory


def test_requests_within_the_allowance_are_permitted() -> None:
    limiter = InMemoryRateLimiter()

    results = [limiter.check("k", limit=3, window_seconds=60) for _ in range(3)]

    assert all(result.allowed for result in results)


def test_the_request_past_the_allowance_is_refused_with_a_retry_hint() -> None:
    limiter = InMemoryRateLimiter()
    for _ in range(3):
        limiter.check("k", limit=3, window_seconds=60)

    result = limiter.check("k", limit=3, window_seconds=60)

    assert result.allowed is False
    assert result.retry_after_seconds > 0


def test_separate_callers_do_not_share_an_allowance() -> None:
    limiter = InMemoryRateLimiter()
    for _ in range(3):
        limiter.check("caller-a", limit=3, window_seconds=60)

    assert limiter.check("caller-b", limit=3, window_seconds=60).allowed is True


def test_the_window_reopens_once_it_has_elapsed() -> None:
    limiter = InMemoryRateLimiter()
    limiter.check("k", limit=1, window_seconds=0)

    assert limiter.check("k", limit=1, window_seconds=0).allowed is True


# ----------------------------------------------------------------- redis


def test_the_redis_limiter_counts_within_a_window() -> None:
    limiter = _redis_limiter(FakeRedis())

    allowed = [limiter.check("k", limit=2, window_seconds=60).allowed for _ in range(3)]

    assert allowed == [True, True, False]


def test_the_redis_limiter_sets_an_expiry_on_the_first_hit() -> None:
    client = FakeRedis()
    limiter = _redis_limiter(client)

    limiter.check("k", limit=5, window_seconds=90)

    assert client.expiries["analyst:rate:k"] == 90


def test_a_redis_outage_fails_open_rather_than_blocking_sign_in() -> None:
    """A cache outage must not become an authentication outage."""

    class BrokenRedis(FakeRedis):
        def pipeline(self):
            raise ConnectionError("redis is unreachable")

    limiter = _redis_limiter(BrokenRedis())

    assert limiter.check("k", limit=1, window_seconds=60).allowed is True


# --------------------------------------------------------------- enforce


def test_enforce_raises_429_with_a_retry_after_header() -> None:
    limiter = InMemoryRateLimiter()
    settings = Settings(app_env="test")
    limiter.check("k", limit=1, window_seconds=60)

    with pytest.raises(HTTPException) as caught:
        enforce(limiter, settings=settings, key="k", limit=1, window_seconds=60)

    assert caught.value.status_code == 429
    assert "Retry-After" in caught.value.headers


def test_enforce_is_inert_when_limiting_is_switched_off() -> None:
    limiter = InMemoryRateLimiter()
    settings = Settings(app_env="test", rate_limit_enabled=False)

    for _ in range(10):
        enforce(limiter, settings=settings, key="k", limit=1, window_seconds=60)


def test_expensive_work_is_refused_when_its_distributed_limiter_is_unavailable() -> None:
    class BrokenRedis(FakeRedis):
        def pipeline(self):
            raise ConnectionError("redis is unreachable")

    with pytest.raises(HTTPException) as caught:
        enforce(
            _redis_limiter(BrokenRedis()),
            settings=Settings(app_env="test"),
            key="k",
            limit=1,
            window_seconds=60,
            unavailable="reject",
        )

    assert caught.value.status_code == 503


# ------------------------------------------------------------ identifier


def test_a_forwarded_address_is_ignored_until_a_proxy_is_explicitly_trusted() -> None:
    request = _request({"X-Forwarded-For": "203.0.113.7, 70.41.3.18"})

    assert client_identifier(request) == "10.0.0.1"


def test_the_forwarded_client_address_is_used_when_the_proxy_is_trusted() -> None:
    request = _request({"X-Forwarded-For": "203.0.113.7, 70.41.3.18"})

    assert client_identifier(request, trust_forwarded_headers=True) == "203.0.113.7"


def test_the_socket_address_is_used_without_a_forwarding_header() -> None:
    assert client_identifier(_request()) == "10.0.0.1"


def test_an_empty_forwarding_header_falls_back_to_the_socket() -> None:
    assert (
        client_identifier(_request({"X-Forwarded-For": ""}), trust_forwarded_headers=True)
        == "10.0.0.1"
    )


def test_rate_limit_keys_do_not_embed_the_limited_subject() -> None:
    key = rate_limit_key("login", "email", "reader@example.test")

    assert "reader@example.test" not in key
    assert key.startswith("login:email:")


# --------------------------------------------------------------- factory


def test_the_factory_falls_back_to_a_local_limiter_without_redis() -> None:
    assert isinstance(build_rate_limiter(Settings(app_env="test")), InMemoryRateLimiter)
