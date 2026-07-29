from app.agents.data import data_agent
from app.agents.state import new_agent_state
from app.services.safe_sql import SqlQueryResult


def test_data_agent_adds_a_bounded_sql_result_to_shared_state() -> None:
    state = new_agent_state("Which region had the highest revenue?")

    def generate_sql(prompt: str) -> str:
        assert "analytics.monthly_metrics" in prompt
        return "SELECT region FROM analytics.monthly_metrics LIMIT 1"

    def execute_sql(query: str) -> SqlQueryResult:
        assert query.endswith("LIMIT 1")
        return SqlQueryResult(columns=["region"], rows=[{"region": "East"}])

    update = data_agent(state, generate_sql=generate_sql, execute_sql=execute_sql)

    assert update["steps"] == ["data(sql)"]
    assert '"East"' in str(update["sql_result"])
