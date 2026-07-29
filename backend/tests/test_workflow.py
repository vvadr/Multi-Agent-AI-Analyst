from app.agents.workflow import WorkflowDependencies, run_workflow
from app.ingestion.service import SearchResult
from app.services.observability import NoopObservability
from app.services.safe_sql import SqlQueryResult
from app.services.web_search import WebSearchResult


def test_graph_routes_retrieval_generates_answer_and_emits_safe_events() -> None:
    events: list[str] = []

    def generate(prompt: str) -> str:
        if "You route" in prompt:
            if "Completed steps: []" in prompt:
                return '{"next":"retriever"}'
            return '{"next":"finish"}'
        if "Return JSON only" in prompt:
            return '{"ok":true,"reason":"Supported"}'
        return "Sustainability was a core investment priority."

    def search_documents(**_kwargs: object) -> list[SearchResult]:
        return [
            SearchResult(
                document_id="report-1",
                filename="report.txt",
                chunk_index=0,
                content="Sustainability was a core investment priority.",
                score=0.99,
            )
        ]

    state = run_workflow(
        "What was a priority?",
        dependencies=WorkflowDependencies(
            generate=generate,
            search_documents=search_documents,
            search_web=lambda **_kwargs: [],
            execute_sql=None,
            tenant_id="demo",
            max_steps=8,
        ),
        emit=lambda event, _data: events.append(event),
    )

    assert state["answer"].startswith("Sustainability")
    assert state["citations"][0]["kind"] == "document"
    assert events == ["routing", "retrieving", "routing", "generating"]


def test_graph_can_route_a_numeric_question_to_the_approved_sql_agent() -> None:
    def generate(prompt: str) -> str:
        if "You route" in prompt:
            return '{"next":"data"}' if "Completed steps: []" in prompt else '{"next":"finish"}'
        if "SQL only" in prompt:
            return "SELECT revenue FROM analytics.monthly_metrics LIMIT 1"
        if "Return JSON only" in prompt:
            return '{"ok":true,"reason":"Supported"}'
        return "East revenue was 125000."

    state = run_workflow(
        "What was revenue?",
        dependencies=WorkflowDependencies(
            generate=generate,
            search_documents=lambda **_kwargs: [],
            search_web=lambda **_kwargs: list[WebSearchResult](),
            execute_sql=lambda _query: SqlQueryResult(
                columns=["revenue"], rows=[{"revenue": 125000}]
            ),
            tenant_id="demo",
            max_steps=8,
        ),
    )

    assert "data(sql)" in state["steps"]
    assert state["citations"][0]["kind"] == "analytics"


def test_graph_includes_recalled_memory_in_generation_context() -> None:
    prompts: list[str] = []

    def generate(prompt: str) -> str:
        prompts.append(prompt)
        if "You route" in prompt:
            return '{"next":"finish"}'
        if "Return JSON only" in prompt:
            return '{"ok":true,"reason":"Supported"}'
        return "The earlier answer is still relevant."

    run_workflow(
        "What about that?",
        dependencies=WorkflowDependencies(
            generate=generate,
            search_documents=lambda **_kwargs: [],
            search_web=lambda **_kwargs: [],
            execute_sql=None,
            tenant_id="demo",
            max_steps=8,
            recall_memory=lambda _question, _limit: ["Earlier answer: sustainability"],
        ),
    )

    assert any("Earlier answer: sustainability" in prompt for prompt in prompts)


class _RecordedObservability(NoopObservability):
    def __init__(self) -> None:
        self.spans: list[tuple[str, str]] = []

    def span(self, name: str, *, kind: str = "span"):
        parent = self

        class _Span:
            def __enter__(self):
                parent.spans.append((name, kind))

            def __exit__(self, *_args: object) -> None:
                return None

        return _Span()


def test_workflow_records_safe_named_agent_and_tool_spans() -> None:
    observability = _RecordedObservability()

    run_workflow(
        "What was a priority?",
        dependencies=WorkflowDependencies(
            generate=lambda _prompt: '{"next":"finish"}'
            if "You route" in _prompt
            else '{"ok":true,"reason":"Supported"}'
            if "Return JSON only" in _prompt
            else "Sustainability was a priority.",
            search_documents=lambda **_kwargs: [],
            search_web=lambda **_kwargs: [],
            execute_sql=None,
            tenant_id="demo",
            max_steps=8,
            recall_memory=lambda _question, _limit: [],
            observability=observability,
        ),
    )

    assert observability.spans == [
        ("memory-recall", "tool"),
        ("supervisor", "agent"),
        ("answer-generation", "chain"),
        ("critic", "evaluator"),
    ]
