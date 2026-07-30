from unittest.mock import MagicMock

import pytest

from app.core.config import Settings
from app.services.safe_sql import (
    SafeSqlExecutor,
    UnsafeQueryError,
    validate_analytics_query,
)

VALID_QUERY = """SELECT region, SUM(revenue) AS total_revenue
FROM analytics.monthly_metrics GROUP BY region ORDER BY total_revenue DESC LIMIT 10"""


def test_validator_accepts_bounded_select_from_approved_source() -> None:
    assert validate_analytics_query(VALID_QUERY, max_rows=100) == VALID_QUERY


@pytest.mark.parametrize(
    "query",
    [
        "DELETE FROM analytics.monthly_metrics",
        "SELECT * FROM public.users LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics LIMIT 1000",
        "SELECT * FROM analytics.monthly_metrics",
        "SELECT * FROM analytics.monthly_metrics LIMIT 1; DROP TABLE users",
        # An unqualified name would resolve through `search_path`, which is not
        # the approved source even when it happens to point at it.
        "SELECT * FROM monthly_metrics LIMIT 5",
    ],
)
def test_validator_rejects_unsafe_or_unbounded_queries(query: str) -> None:
    with pytest.raises(UnsafeQueryError):
        validate_analytics_query(query, max_rows=100)


@pytest.mark.parametrize(
    "query",
    [
        # A comma-separated table list: every entry has to reach the allow-list,
        # not just the first one after FROM.
        "SELECT * FROM analytics.monthly_metrics, users LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics,users LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics , public.users LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics AS m, information_schema.tables t LIMIT 5",
        "SELECT * FROM analytics.monthly_metrics CROSS JOIN users LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics JOIN users u ON 1=1 LIMIT 10",
        "SELECT * FROM analytics.monthly_metrics WHERE id IN (SELECT id FROM users) LIMIT 5",
        # A quoted identifier spells the same table a second way.
        'SELECT * FROM "analytics"."monthly_metrics", users LIMIT 5',
        # A derived table hides its own source list.
        "SELECT * FROM (SELECT * FROM users) x LIMIT 5",
        "SELECT * FROM analytics.monthly_metrics, LIMIT 5",
    ],
)
def test_validator_rejects_every_unapproved_table_reference(query: str) -> None:
    with pytest.raises(UnsafeQueryError):
        validate_analytics_query(query, max_rows=100)


@pytest.mark.parametrize(
    "query",
    [
        # `query_to_xml` takes a whole statement as a string, so it would run
        # past the source allow-list entirely.
        "SELECT query_to_xml('SELECT * FROM users', true, true, '') "
        "FROM analytics.monthly_metrics LIMIT 1",
        "SELECT pg_read_file('/etc/passwd') FROM analytics.monthly_metrics LIMIT 1",
        "SELECT current_setting('is_superuser') FROM analytics.monthly_metrics LIMIT 1",
        "SELECT pg_sleep(30) FROM analytics.monthly_metrics LIMIT 1",
        "SELECT dblink('host=evil', 'SELECT 1') FROM analytics.monthly_metrics LIMIT 1",
    ],
)
def test_validator_rejects_functions_that_escape_the_approved_source(query: str) -> None:
    with pytest.raises(UnsafeQueryError):
        validate_analytics_query(query, max_rows=100)


@pytest.mark.parametrize(
    "query",
    [
        "SELECT * FROM analytics.monthly_metrics WHERE region = 'EU' LIMIT 10",
        "SELECT m.region FROM analytics.monthly_metrics m WHERE m.revenue > 100 LIMIT 5",
        "SELECT region FROM analytics.monthly_metrics AS m ORDER BY month LIMIT 5",
        # A subquery over the approved source is still the approved source. The
        # paren closing it arrives attached to the table name.
        "SELECT region FROM analytics.monthly_metrics "
        "WHERE month = (SELECT MAX(month) FROM analytics.monthly_metrics) LIMIT 20",
        # A self-join reads nothing unapproved.
        "SELECT a.region FROM analytics.monthly_metrics a, analytics.monthly_metrics b LIMIT 5",
        "SELECT COUNT(*) AS n, region FROM analytics.monthly_metrics "
        "GROUP BY region HAVING COUNT(*) > 1 LIMIT 50",
    ],
)
def test_validator_still_accepts_legitimate_analytics_queries(query: str) -> None:
    assert validate_analytics_query(query, max_rows=100) == query


def test_executor_requires_an_explicit_analytics_connection() -> None:
    settings = Settings(app_env="test", enable_sql_agent=True)

    with pytest.raises(ValueError, match="ANALYTICS_DATABASE_URL"):
        SafeSqlExecutor(settings)


def test_executor_starts_a_read_only_transaction(monkeypatch) -> None:
    connection = MagicMock()
    query_result = MagicMock()
    query_result.mappings.return_value.fetchmany.return_value = []
    query_result.keys.return_value = ["region"]
    connection.execute.side_effect = [None, query_result]
    engine = MagicMock()
    engine.begin.return_value.__enter__.return_value = connection
    monkeypatch.setattr("app.services.safe_sql.create_engine", lambda *_args, **_kwargs: engine)
    settings = Settings(
        app_env="test",
        enable_sql_agent=True,
        analytics_database_url="postgresql+psycopg://reader:secret@db/analytics",
    )

    SafeSqlExecutor(settings).execute("SELECT region FROM analytics.monthly_metrics LIMIT 1")

    assert "SET TRANSACTION READ ONLY" in str(connection.execute.call_args_list[0].args[0])
    engine.dispose.assert_called_once()
