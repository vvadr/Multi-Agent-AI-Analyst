"""Process-wide singletons shared by the API routes.

Each of these opens a connection pool or a socket, so they are built once per
process rather than per request. They are plain functions rather than FastAPI
dependencies so the worker — which has no request cycle — can use the same
builders.
"""

from functools import lru_cache

from app.core.config import get_settings
from app.services.email import EmailSender, build_email_sender
from app.services.queue import JobQueue, build_job_queue
from app.services.rate_limit import (
    InMemoryRateLimiter,
    RedisRateLimiter,
    build_rate_limiter,
)


@lru_cache
def get_job_queue() -> JobQueue:
    return build_job_queue(get_settings())


@lru_cache
def get_rate_limiter() -> RedisRateLimiter | InMemoryRateLimiter:
    return build_rate_limiter(get_settings())


@lru_cache
def get_email_sender() -> EmailSender:
    return build_email_sender(get_settings())
