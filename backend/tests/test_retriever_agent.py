from app.agents.retriever import retriever_agent
from app.agents.state import new_agent_state
from app.ingestion.service import SearchResult


def test_retriever_agent_adds_ranked_document_evidence() -> None:
    state = new_agent_state("What were our sustainability priorities?")
    calls: list[dict[str, object]] = []

    def search(**kwargs: object) -> list[SearchResult]:
        calls.append(kwargs)
        return [
            SearchResult(
                document_id="report-1",
                filename="report.txt",
                chunk_index=2,
                content="Sustainability was a core investment priority.",
                score=0.93,
            )
        ]

    update = retriever_agent(state, tenant_id="acme", search=search)

    assert calls == [
        {
            "tenant_id": "acme",
            "query": "What were our sustainability priorities?",
            "limit": 4,
        }
    ]
    assert update["steps"] == ["retriever"]
    assert "report.txt" in update["documents"][0]
    assert "Sustainability" in update["documents"][0]
