from collections.abc import Generator
from functools import lru_cache

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


@lru_cache
def get_engine() -> Engine:
    settings = get_settings()
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL is not configured")
    return create_engine(
        settings.database_url.get_secret_value(),
        pool_pre_ping=True,
        pool_recycle=300,
    )


def create_session() -> Session:
    factory = sessionmaker(bind=get_engine(), expire_on_commit=False)
    return factory()


def get_session() -> Generator[Session, None, None]:
    """Provide one database session per request and always close it."""
    session = create_session()
    try:
        yield session
    finally:
        session.close()
