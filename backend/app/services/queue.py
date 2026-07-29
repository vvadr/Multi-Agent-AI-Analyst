"""Durable job dispatch.

Redis carries the *dispatch*; PostgreSQL carries the truth. A job that Redis
loses to a restart is not lost work: `app.services.reaper` finds rows stranded
in a non-terminal state and re-enqueues them. That division is deliberate — it
means the queue never has to be a database, and the database never has to be
fast.

Two implementations share one interface. `RedisJobQueue` spreads work across a
separate worker service. `InMemoryJobQueue` keeps it in the API process, which
is what runs when `REDIS_URL` is unset — enough for local development and for a
single-instance deployment, since the durable rows and the startup recovery
sweep do the load-bearing work either way.
"""

from __future__ import annotations

import json
import threading
import time
from collections import deque
from dataclasses import dataclass, replace
from typing import Protocol
from uuid import uuid4

import structlog

from app.core.config import Settings

logger = structlog.get_logger(__name__)

JOB_INGEST_DOCUMENT = "ingest_document"
JOB_EXECUTE_RUN = "execute_run"

_KEY_PREFIX = "analyst:jobs"
_PENDING = f"{_KEY_PREFIX}:pending"
_INFLIGHT = f"{_KEY_PREFIX}:inflight"
_DATA = f"{_KEY_PREFIX}:data"
_DEAD = f"{_KEY_PREFIX}:dead"


@dataclass(frozen=True)
class Job:
    """One unit of queued work."""

    id: str
    type: str
    payload: dict[str, object]
    attempts: int = 0


class JobQueue(Protocol):
    def enqueue(self, job_type: str, payload: dict[str, object]) -> str: ...

    def claim(self, *, timeout_seconds: float) -> Job | None: ...

    def ack(self, job: Job) -> None: ...

    def retry(self, job: Job) -> bool: ...

    def recover_expired(self) -> int: ...


class RedisJobQueue:
    """A reliable-handoff queue: pending list, in-flight deadlines, dead letter.

    A claimed job stays in the in-flight set until it is acked. If the worker
    holding it dies, its deadline lapses and `recover_expired` returns the job
    to the pending list, so no crash silently drops work.
    """

    def __init__(self, settings: Settings) -> None:
        if not settings.redis_url:
            raise ValueError("REDIS_URL is required for the durable job queue")
        # Imported lazily so the package stays optional for tooling that only
        # touches configuration (Alembic, the OpenAPI dump, evaluation CLIs).
        import redis

        self._client = redis.Redis.from_url(
            settings.redis_url.get_secret_value(),
            decode_responses=True,
            socket_timeout=settings.service_probe_timeout_seconds,
            socket_connect_timeout=settings.service_probe_timeout_seconds,
        )
        self._max_attempts = settings.job_max_attempts
        self._visibility = settings.job_visibility_timeout_seconds

    def enqueue(self, job_type: str, payload: dict[str, object]) -> str:
        job = Job(id=str(uuid4()), type=job_type, payload=payload)
        pipe = self._client.pipeline()
        pipe.hset(_DATA, job.id, _dump(job))
        pipe.rpush(_PENDING, job.id)
        pipe.execute()
        return job.id

    def claim(self, *, timeout_seconds: float) -> Job | None:
        # BLPOP blocks rather than spinning, so an idle worker costs nothing.
        popped = self._client.blpop([_PENDING], timeout=max(1, int(timeout_seconds)))
        if not popped:
            return None
        job_id = popped[1]
        raw = self._client.hget(_DATA, job_id)
        if not raw:
            # Acked or dead-lettered by a reaper between push and pop.
            return None
        job = _load(raw)
        if job is None:
            self._client.hdel(_DATA, job_id)
            return None
        self._client.zadd(_INFLIGHT, {job_id: time.time() + self._visibility})
        return job

    def ack(self, job: Job) -> None:
        pipe = self._client.pipeline()
        pipe.zrem(_INFLIGHT, job.id)
        pipe.hdel(_DATA, job.id)
        pipe.execute()

    def retry(self, job: Job) -> bool:
        """Requeue with one more attempt recorded. False once attempts run out."""
        attempted = replace(job, attempts=job.attempts + 1)
        if attempted.attempts >= self._max_attempts:
            pipe = self._client.pipeline()
            pipe.zrem(_INFLIGHT, job.id)
            pipe.hdel(_DATA, job.id)
            pipe.rpush(_DEAD, _dump(attempted))
            pipe.execute()
            logger.warning("job_dead_lettered", job_type=job.type, attempts=attempted.attempts)
            return False
        pipe = self._client.pipeline()
        pipe.hset(_DATA, job.id, _dump(attempted))
        pipe.zrem(_INFLIGHT, job.id)
        pipe.rpush(_PENDING, job.id)
        pipe.execute()
        return True

    def recover_expired(self) -> int:
        """Return jobs whose holder died back to the pending list."""
        expired = self._client.zrangebyscore(_INFLIGHT, "-inf", time.time())
        recovered = 0
        for job_id in expired:
            raw = self._client.hget(_DATA, job_id)
            if not raw:
                self._client.zrem(_INFLIGHT, job_id)
                continue
            job = _load(raw)
            if job is None:
                self._client.zrem(_INFLIGHT, job_id)
                self._client.hdel(_DATA, job_id)
                continue
            if self.retry(job):
                recovered += 1
        if recovered:
            logger.info("jobs_recovered", count=recovered)
        return recovered

    def ping(self) -> None:
        self._client.ping()


class InMemoryJobQueue:
    """Process-local queue for local development and tests."""

    def __init__(self, settings: Settings) -> None:
        self._max_attempts = settings.job_max_attempts
        self._pending: deque[Job] = deque()
        self._condition = threading.Condition()
        self.dead: list[Job] = []

    def enqueue(self, job_type: str, payload: dict[str, object]) -> str:
        job = Job(id=str(uuid4()), type=job_type, payload=payload)
        with self._condition:
            self._pending.append(job)
            self._condition.notify()
        return job.id

    def claim(self, *, timeout_seconds: float) -> Job | None:
        with self._condition:
            if not self._pending:
                self._condition.wait(timeout=timeout_seconds)
            return self._pending.popleft() if self._pending else None

    def ack(self, job: Job) -> None:
        return None

    def retry(self, job: Job) -> bool:
        attempted = replace(job, attempts=job.attempts + 1)
        if attempted.attempts >= self._max_attempts:
            self.dead.append(attempted)
            return False
        with self._condition:
            self._pending.append(attempted)
            self._condition.notify()
        return True

    def recover_expired(self) -> int:
        # Nothing can outlive this process, so there is nothing to recover.
        return 0


def _dump(job: Job) -> str:
    return json.dumps(
        {"id": job.id, "type": job.type, "payload": job.payload, "attempts": job.attempts}
    )


def _load(raw: str) -> Job | None:
    try:
        parsed = json.loads(raw)
        return Job(
            id=str(parsed["id"]),
            type=str(parsed["type"]),
            payload=dict(parsed["payload"]),
            attempts=int(parsed.get("attempts", 0)),
        )
    except (TypeError, ValueError, KeyError):
        logger.warning("job_payload_unreadable")
        return None


def build_job_queue(settings: Settings) -> JobQueue:
    """Redis when configured, otherwise a process-local queue.

    Production never reaches the fallback: `Settings` refuses to validate a
    production environment that has no `REDIS_URL`.
    """
    if settings.redis_url:
        return RedisJobQueue(settings)
    return InMemoryJobQueue(settings)
