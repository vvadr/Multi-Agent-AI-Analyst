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

# Functions that run SQL supplied as a string, reach the filesystem, read server
# configuration, or stall the connection. `SET TRANSACTION READ ONLY` stops
# writes but none of these, and `query_to_xml` in particular takes an entire
# statement as text — it would drive straight past the source allow-list below.
_DISALLOWED_FUNCTIONS = re.compile(
    r"\b(?:query_to_xml\w*|dblink\w*|pg_read_file|pg_read_binary_file|"
    r"pg_read_server_files|pg_ls_dir|pg_stat_file|pg_sleep\w*|lo_import|"
    r"lo_export|pg_logical_emit_message|pg_get_viewdef|set_config|"
    r"current_setting|to_regclass|pg_terminate_backend|pg_cancel_backend|"
    r"pg_reload_conf)\s*\(",
    re.IGNORECASE,
)

# Keywords that end a FROM/JOIN table-reference list. Without them the capture
# below would run to the end of the statement and swallow the WHERE clause.
_CLAUSE_BOUNDARY = (
    r"WHERE|GROUP|ORDER|HAVING|LIMIT|OFFSET|WINDOW|FETCH|FOR|"
    r"UNION|INTERSECT|EXCEPT|JOIN|INNER|LEFT|RIGHT|FULL|CROSS|NATURAL|ON|USING"
)

# One FROM or JOIN and the whole table-reference list that follows it, rather
# than only that list's first entry. Capturing just the first entry is what let
# `FROM analytics.monthly_metrics, users` through: the comma-separated second
# table was never seen by the allow-list at all.
_SOURCE_LIST_PATTERN = re.compile(
    rf"\b(?:FROM|JOIN)\s+(.*?)(?=\b(?:{_CLAUSE_BOUNDARY})\b|$)",
    re.IGNORECASE | re.DOTALL,
)
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


def _table_references(normalized: str) -> set[str]:
    """Every table named by a FROM or JOIN, including comma-separated entries.

    Each entry is reduced to its first token, so `analytics.monthly_metrics AS m`
    and `analytics.monthly_metrics m` both resolve to the table they name. A
    derived table is refused outright: the policy is a single approved view, so
    there is no query worth supporting that opens a parenthesis here, and
    allowing one would mean re-implementing enough of a SQL parser to know what
    is inside it.
    """
    references: set[str] = set()
    for clause in _SOURCE_LIST_PATTERN.findall(normalized):
        for entry in clause.split(","):
            entry = entry.strip()
            if not entry:
                # A trailing or doubled comma. Malformed rather than ignorable —
                # anything this validator cannot read, it must not pass.
                raise UnsafeQueryError("query has a malformed table reference")
            if entry.startswith("("):
                raise UnsafeQueryError("query must not use a derived table")
            # A subquery in WHERE ends with the paren that closes it, and that
            # paren arrives attached to the table name. No table name can
            # contain one, so removing it cannot admit anything.
            name = entry.split()[0].rstrip(")").lower()
            if not name:
                raise UnsafeQueryError("query has a malformed table reference")
            references.add(name)
    return references


def validate_analytics_query(query: str, *, max_rows: int) -> str:
    """Accept only one bounded SELECT over the explicitly approved analytics view."""
    normalized = query.strip().removesuffix(";").strip()
    if not normalized:
        raise UnsafeQueryError("query must not be empty")
    if len(normalized) > 10_000:
        raise UnsafeQueryError("query is too long")
    if ";" in normalized or "--" in normalized or "/*" in normalized:
        raise UnsafeQueryError("query must contain one statement without comments")
    # A double-quoted identifier can spell an unapproved table in a way the
    # allow-list below would not recognise, and dollar quoting hides a string
    # from every check here. The approved view needs neither.
    if '"' in normalized or "$" in normalized:
        raise UnsafeQueryError("query must not use quoted identifiers or dollar quoting")
    if not normalized.upper().startswith("SELECT"):
        raise UnsafeQueryError("only SELECT statements are allowed")
    if _DISALLOWED_SQL.search(normalized):
        raise UnsafeQueryError("query contains a disallowed SQL operation")
    if _DISALLOWED_FUNCTIONS.search(normalized):
        raise UnsafeQueryError("query calls a disallowed function")

    sources = _table_references(normalized)
    if not sources or not sources.issubset(APPROVED_SOURCES):
        raise UnsafeQueryError("query references an unapproved analytics source")

    limit = _LIMIT_PATTERN.search(normalized)
    if not limit:
        raise UnsafeQueryError("query must include a LIMIT")
    if not 1 <= int(limit.group(1)) <= max_rows:
        raise UnsafeQueryError("query LIMIT is outside the allowed range")
    return normalized
