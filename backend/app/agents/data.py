"""Safe text-to-SQL agent over a fixed, approved analytics view."""

import json
from collections.abc import Callable

from app.agents.state import AgentState, Citation
from app.services.safe_sql import SqlQueryResult

SqlGenerator = Callable[[str], str]
SqlExecutor = Callable[[str], SqlQueryResult]

ANALYTICS_SCHEMA = """Approved source: analytics.monthly_metrics
Columns: month (date), region (text), revenue (numeric), active_customers (integer).
Use exactly one PostgreSQL SELECT statement over that source. Include LIMIT <= 100.
Write the table name in full and unquoted; analytics.monthly_metrics is the only
table you may name anywhere in the statement, including inside any subquery.
Do not use comments, CTEs, derived tables (a subquery in FROM), quoted
identifiers, system tables, or data-modifying statements."""


def data_agent(
    state: AgentState,
    *,
    generate_sql: SqlGenerator,
    execute_sql: SqlExecutor,
) -> dict[str, object]:
    """Generate and execute one bounded analytics query, then update shared state."""
    prompt = f"{ANALYTICS_SCHEMA}\n\nQuestion: {state['question']}\nSQL only:"
    query = generate_sql(prompt).strip()
    result = execute_sql(query)
    result_text = json.dumps(
        {"columns": result.columns, "rows": result.rows}, default=str, ensure_ascii=False
    )
    citation: Citation = {
        "id": "analytics:monthly_metrics",
        "kind": "analytics",
        "title": "Synthetic monthly metrics",
        "excerpt": result_text[:500],
    }
    return {
        "sql_result": f"{query}\n→ {result_text}",
        "steps": [*state["steps"], "data(sql)"],
        "citations": [*state["citations"], citation],
    }
