"""Queue semantics: hand-off, retry, dead-lettering, and crash recovery.

`RedisJobQueue` is exercised against a substitute client rather than a live
server so the reliability rules — an unacked job stays claimable, a job past its
attempt ceiling leaves the pipeline — are asserted directly.
"""

from __future__ import annotations

import time
from typing import Any

import pytest

from app.core.config import Settings
from app.services import queue as queue_module
from app.services.queue import (
    InMemoryJobQueue,
    Job,
    RedisJobQueue,
    _dump,
    _load,
    build_job_queue,
)


class FakePipeline:
    def __init__(self, client: FakeRedis) -> None:
        self._client = client
        self._commands: list[tuple[str, tuple[Any, ...]]] = []

    def __getattr__(self, name: str):
        def record(*args: Any) -> FakePipeline:
            self._commands.append((name, args))
            return self

        return record

    def execute(self) -> list[Any]:
        results = [getattr(self._client, name)(*args) for name, args in self._commands]
        self._commands.clear()
        return results


class FakeRedis:
    """The subset of the Redis surface the queue and limiter actually use."""

    def __init__(self) -> None:
        self.lists: dict[str, list[str]] = {}
        self.hashes: dict[str, dict[str, str]] = {}
        self.zsets: dict[str, dict[str, float]] = {}
        self.counters: dict[str, int] = {}
        self.expiries: dict[str, int] = {}

    def pipeline(self) -> FakePipeline:
        return FakePipeline(self)

    def hset(self, key: str, field: str, value: str) -> int:
        self.hashes.setdefault(key, {})[field] = value
        return 1

    def hget(self, key: str, field: str) -> str | None:
        return self.hashes.get(key, {}).get(field)

    def hdel(self, key: str, field: str) -> int:
        return 1 if self.hashes.get(key, {}).pop(field, None) is not None else 0

    def rpush(self, key: str, value: str) -> int:
        self.lists.setdefault(key, []).append(value)
        return len(self.lists[key])

    def blpop(self, keys: list[str], timeout: int = 0) -> tuple[str, str] | None:
        for key in keys:
            if self.lists.get(key):
                return key, self.lists[key].pop(0)
        return None

    def zadd(self, key: str, mapping: dict[str, float]) -> int:
        self.zsets.setdefault(key, {}).update(mapping)
        return len(mapping)

    def zrem(self, key: str, member: str) -> int:
        return 1 if self.zsets.get(key, {}).pop(member, None) is not None else 0

    def zrangebyscore(self, key: str, minimum: Any, maximum: Any) -> list[str]:
        ceiling = float(maximum) if maximum != "+inf" else float("inf")
        return [
            member for member, score in self.zsets.get(key, {}).items() if score <= ceiling
        ]

    def incr(self, key: str) -> int:
        self.counters[key] = self.counters.get(key, 0) + 1
        return self.counters[key]

    def ttl(self, key: str) -> int:
        return self.expiries.get(key, -1)

    def expire(self, key: str, seconds: int) -> bool:
        self.expiries[key] = seconds
        return True

    def ping(self) -> bool:
        return True


@pytest.fixture
def redis_queue(monkeypatch: pytest.MonkeyPatch) -> tuple[RedisJobQueue, FakeRedis]:
    client = FakeRedis()
    settings = Settings(
        app_env="test", redis_url="redis://localhost:6379", job_max_attempts=2
    )
    queue = RedisJobQueue.__new__(RedisJobQueue)
    queue._client = client
    queue._max_attempts = settings.job_max_attempts
    queue._visibility = settings.job_visibility_timeout_seconds
    return queue, client


# ------------------------------------------------------- serialization


def test_a_job_survives_a_serialization_round_trip() -> None:
    job = Job(id="abc", type="execute_run", payload={"run_id": "r1"}, attempts=2)

    assert _load(_dump(job)) == job


def test_an_unreadable_payload_is_discarded_rather_than_raising() -> None:
    assert _load("not json at all") is None
    assert _load('{"id": "a"}') is None


# ------------------------------------------------------------- in-memory


def test_the_in_memory_queue_returns_what_it_was_given() -> None:
    queue = InMemoryJobQueue(Settings(app_env="test"))
    queue.enqueue("execute_run", {"run_id": "r1"})

    claimed = queue.claim(timeout_seconds=0)

    assert claimed is not None
    assert (claimed.type, claimed.payload) == ("execute_run", {"run_id": "r1"})


def test_the_in_memory_queue_dead_letters_after_the_attempt_ceiling() -> None:
    queue = InMemoryJobQueue(Settings(app_env="test", job_max_attempts=2))
    job = Job(id="j", type="execute_run", payload={}, attempts=1)

    assert queue.retry(job) is False
    assert len(queue.dead) == 1


def test_an_empty_queue_claims_nothing() -> None:
    queue = InMemoryJobQueue(Settings(app_env="test"))

    assert queue.claim(timeout_seconds=0) is None


# ----------------------------------------------------------------- redis


def test_claiming_moves_a_job_into_the_in_flight_set(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    queue, client = redis_queue
    queue.enqueue("execute_run", {"run_id": "r1"})

    job = queue.claim(timeout_seconds=1)

    assert job is not None
    assert job.payload == {"run_id": "r1"}
    # Held, not lost: an unacked job remains recoverable.
    assert list(client.zsets["analyst:jobs:inflight"]) == [job.id]


def test_acking_clears_both_the_payload_and_the_in_flight_entry(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    queue, client = redis_queue
    queue.enqueue("execute_run", {"run_id": "r1"})
    job = queue.claim(timeout_seconds=1)

    queue.ack(job)

    assert client.zsets["analyst:jobs:inflight"] == {}
    assert client.hashes["analyst:jobs:data"] == {}


def test_retrying_returns_the_job_to_the_pending_list_with_a_higher_count(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    queue, client = redis_queue
    queue.enqueue("execute_run", {"run_id": "r1"})
    job = queue.claim(timeout_seconds=1)

    assert queue.retry(job) is True

    requeued = queue.claim(timeout_seconds=1)
    assert requeued is not None
    assert requeued.attempts == 1
    assert client.lists["analyst:jobs:pending"] == []


def test_a_job_past_the_attempt_ceiling_is_dead_lettered(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    queue, client = redis_queue
    job = Job(id="j", type="execute_run", payload={}, attempts=1)

    assert queue.retry(job) is False

    assert len(client.lists["analyst:jobs:dead"]) == 1
    assert client.lists.get("analyst:jobs:pending", []) == []


def test_a_lapsed_visibility_deadline_returns_the_job_to_the_queue(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    """A worker that dies mid-job must not take the job with it."""
    queue, client = redis_queue
    queue.enqueue("execute_run", {"run_id": "r1"})
    job = queue.claim(timeout_seconds=1)
    # The holder has gone silent past its deadline.
    client.zsets["analyst:jobs:inflight"][job.id] = time.time() - 1

    assert queue.recover_expired() == 1

    recovered = queue.claim(timeout_seconds=1)
    assert recovered is not None
    assert recovered.payload == {"run_id": "r1"}


def test_claiming_a_job_whose_payload_vanished_yields_nothing(
    redis_queue: tuple[RedisJobQueue, FakeRedis],
) -> None:
    queue, client = redis_queue
    queue.enqueue("execute_run", {"run_id": "r1"})
    client.hashes["analyst:jobs:data"].clear()

    assert queue.claim(timeout_seconds=1) is None


# --------------------------------------------------------------- factory


def test_the_factory_falls_back_to_a_local_queue_without_redis() -> None:
    assert isinstance(build_job_queue(Settings(app_env="test")), InMemoryJobQueue)


def test_the_factory_selects_redis_when_configured(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(
        queue_module.RedisJobQueue, "__init__", lambda self, settings: None
    )

    built = build_job_queue(Settings(app_env="test", redis_url="redis://localhost:6379"))

    assert isinstance(built, RedisJobQueue)
