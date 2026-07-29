"""The state contract passed between every future agent-graph node."""

from typing import Literal, NotRequired, TypedDict


class Citation(TypedDict):
    """Safe source metadata returned with a completed analyst run."""

    id: str
    kind: Literal["document", "web", "analytics"]
    title: str
    excerpt: str
    url: NotRequired[str]
    document_id: NotRequired[str]
    chunk_index: NotRequired[int]


class AgentState(TypedDict):
    """Mutable working state for a single analyst run.

    Keeping the contract in one module prevents agents from inventing
    incompatible keys as the graph is introduced in later phases.
    """

    question: str
    plan: str
    documents: list[str]
    sql_result: str | None
    code_result: str | None
    answer: str
    steps: list[str]
    revisions: int
    citations: list[Citation]


def new_agent_state(question: str) -> AgentState:
    """Create a complete, safe initial state for a new analyst run."""
    normalized_question = question.strip()
    if not normalized_question:
        raise ValueError("question must not be empty")
    return {
        "question": normalized_question,
        "plan": "",
        "documents": [],
        "sql_result": None,
        "code_result": None,
        "answer": "",
        "steps": [],
        "revisions": 0,
        "citations": [],
    }
