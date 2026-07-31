from unittest.mock import MagicMock

from app.core.config import Settings
from app.services.memory import ConversationMemory


def _memory(monkeypatch, client: MagicMock) -> ConversationMemory:
    monkeypatch.setattr("app.services.memory.QdrantClient", lambda **_kwargs: client)
    monkeypatch.setattr(
        "app.services.memory.build_embedding_provider",
        lambda _settings: MagicMock(embed=lambda texts: [[0.0, 1.0, 0.0] for _ in texts]),
    )
    return ConversationMemory(
        Settings(
            app_env="test",
            qdrant_url="http://qdrant:6333",
            qdrant_api_key="test-key",
            embedding_dimensions=3,
        )
    )


def test_recall_filters_by_tenant_on_an_indexed_field(monkeypatch) -> None:
    """`recall` filters on `tenant_id`, which Qdrant rejects unless it is indexed.

    Worth asserting despite looking internal: the caller swallows recall
    failures so a lost follow-up hint never fails a good answer, which means a
    missing index turns memory off permanently without surfacing anything.
    """
    client = MagicMock()
    client.collection_exists.return_value = False
    client.query_points.return_value.points = []
    memory = _memory(monkeypatch, client)

    memory.recall("what did we conclude?", tenant_id="acme")

    query_filter = client.query_points.call_args.kwargs["query_filter"]
    assert query_filter.must[0].key == "tenant_id"
    indexed = {call.kwargs["field_name"] for call in client.create_payload_index.call_args_list}
    assert "tenant_id" in indexed


def test_memory_is_stored_in_its_own_collection(monkeypatch) -> None:
    """Conversation history and document evidence must not share a namespace."""
    client = MagicMock()
    client.collection_exists.return_value = False
    memory = _memory(monkeypatch, client)

    memory.remember(tenant_id="acme", question="q", answer="a")

    assert memory.collection.endswith("_memory")
    assert client.upsert.call_args.kwargs["collection_name"] == memory.collection
