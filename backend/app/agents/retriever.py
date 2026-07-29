"""Retriever agent for tenant-filtered document evidence."""

from collections.abc import Callable

from app.agents.state import AgentState, Citation
from app.ingestion.service import SearchResult

Retriever = Callable[..., list[SearchResult]]


def retriever_agent(
    state: AgentState,
    *,
    tenant_id: str,
    search: Retriever,
    limit: int = 4,
) -> dict[str, object]:
    """Retrieve evidence for one tenant and append it to the shared state."""
    if not tenant_id.strip():
        raise ValueError("tenant_id must not be empty")

    results = search(tenant_id=tenant_id, query=state["question"], limit=limit)
    documents = [
        (
            f"[Document: {result.filename}, chunk {result.chunk_index + 1}, "
            f"score {result.score:.3f}]\n{result.content}"
        )
        for result in results
    ]
    citations: list[Citation] = [
        {
            "id": f"document:{result.document_id}:{result.chunk_index}",
            "kind": "document",
            "title": result.filename,
            "excerpt": result.content[:500],
            "document_id": result.document_id,
            "chunk_index": result.chunk_index,
        }
        for result in results
    ]
    return {
        "documents": [*state["documents"], *documents],
        "steps": [*state["steps"], "retriever"],
        "citations": [*state["citations"], *citations],
    }
