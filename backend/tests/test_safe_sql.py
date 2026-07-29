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
    ],
)
def test_validator_rejects_unsafe_or_unbounded_queries(query: str) -> None:
    with pytest.raises(UnsafeQueryError):
        validate_analytics_query(query, max_rows=100)


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
