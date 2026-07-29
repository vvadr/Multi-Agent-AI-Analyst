"""Restricted read-only SQL execution against approved analytics sources."""

import re
from dataclasses import dataclass

from sqlalchemy import create_engine, text

from app.core.config import Settings

APPROVED_SOURCES = frozenset({"analytics.monthly_metrics"})
_DISALLOWED_SQL = re.compile(
    r"\b(ALTER|ANALYZE|CALL|COPY|CREATE|DELETE|DROP|EXEC|GRANT|INSERT|MERGE|"
    r"REVOKE|TRUNCATE|UPDATE|VACUUM)\b",
    re.IGNORECASE,
)
_SOURCE_PATTERN = re.compile(r"\b(?:FROM|JOIN)\s+([\w.]+)", re.IGNORECASE)
_LIMIT_PATTERN = re.compile(r"\bLIMIT\s+(\d+)\s*$", re.IGNORECASE)


class UnsafeQueryError(ValueError):
    """A generated query violates the fixed read-only analytics policy."""


@dataclass(frozen=True)
class SqlQueryResult:
    columns: list[str]
    rows: list[dict[str, object]]


class SafeSqlExecutor:
    """Execute one bounded SELECT against a narrow, approved analytics surface."""

    def __init__(self, settings: Settings) -> None:
        if not settings.enable_sql_agent:
            raise ValueError("SQL agent is disabled")
        analytics_url = settings.analytics_database_url
        # The local demo intentionally keeps synthetic analytics alongside its
        # disposable development database. Production is still validated to
        # require a dedicated read-only analytics URL.
        if not analytics_url and settings.app_env == "development":
            analytics_url = settings.database_url
        if not analytics_url:
            raise ValueError("ANALYTICS_DATABASE_URL is required when SQL is enabled")
        self.database_url = analytics_url.get_secret_value()
        self.max_rows = settings.max_result_rows
        self.statement_timeout_ms = settings.sql_statement_timeout_ms

    def execute(self, query: str) -> SqlQueryResult:
        safe_query = validate_analytics_query(query, max_rows=self.max_rows)
        engine = create_engine(
            self.database_url,
            connect_args={"options": f"-c statement_timeout={self.statement_timeout_ms}"},
            pool_pre_ping=True,
        )
        try:
            with engine.begin() as connection:
                connection.execute(text("SET TRANSACTION READ ONLY"))
                result = connection.execute(text(safe_query)).mappings()
                rows = [dict(row) for row in result.fetchmany(self.max_rows)]
                return SqlQueryResult(columns=list(result.keys()), rows=rows)
        finally:
            engine.dispose()


def validate_analytics_query(query: str, *, max_rows: int) -> str:
    """Accept only one bounded SELECT over the explicitly approved analytics view."""
    normalized = query.strip().removesuffix(";").strip()
    if not normalized:
        raise UnsafeQueryError("query must not be empty")
    if len(normalized) > 10_000:
        raise UnsafeQueryError("query is too long")
    if ";" in normalized or "--" in normalized or "/*" in normalized:
        raise UnsafeQueryError("query must contain one statement without comments")
    if not normalized.upper().startswith("SELECT"):
        raise UnsafeQueryError("only SELECT statements are allowed")
    if _DISALLOWED_SQL.search(normalized):
        raise UnsafeQueryError("query contains a disallowed SQL operation")

    sources = {source.lower() for source in _SOURCE_PATTERN.findall(normalized)}
    if not sources or not sources.issubset(APPROVED_SOURCES):
        raise UnsafeQueryError("query references an unapproved analytics source")

    limit = _LIMIT_PATTERN.search(normalized)
    if not limit:
        raise UnsafeQueryError("query must include a LIMIT")
    if not 1 <= int(limit.group(1)) <= max_rows:
        raise UnsafeQueryError("query LIMIT is outside the allowed range")
    return normalized
