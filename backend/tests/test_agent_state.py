import pytest

from app.agents.state import new_agent_state


def test_new_agent_state_is_complete_and_isolated() -> None:
    state = new_agent_state("  What changed this quarter?  ")

    assert state == {
        "question": "What changed this quarter?",
        "plan": "",
        "documents": [],
        "sql_result": None,
        "code_result": None,
        "answer": "",
        "steps": [],
        "revisions": 0,
        "citations": [],
        "memory": [],
    }


def test_new_agent_state_rejects_an_empty_question() -> None:
    with pytest.raises(ValueError, match="question"):
        new_agent_state("  ")
