from unittest.mock import MagicMock

from app.core.config import Settings
from app.ingestion.service import VectorPoint
from app.services.vector_store import QdrantVectorStore


def _settings() -> Settings:
    return Settings(
        app_env="test",
        qdrant_url="http://qdrant:6333",
        qdrant_api_key="test-key",
        embedding_dimensions=3,
    )


def test_qdrant_adapter_creates_a_fixed_dimension_collection_and_upserts(monkeypatch) -> None:
    client = MagicMock()
    client.collection_exists.return_value = False
    monkeypatch.setattr("app.services.vector_store.QdrantClient", lambda **_kwargs: client)
    store = QdrantVectorStore(_settings())

    store.upsert(
        [
            VectorPoint(
                id="1a88c268-2a25-4f36-bfa1-a865a96ad734",
                vector=[0.0, 1.0, 0.0],
                tenant_id="acme",
                document_id="report",
                filename="report.txt",
                chunk_index=0,
                content="sustainability",
            )
        ]
    )

    client.create_collection.assert_called_once()
    assert client.create_collection.call_args.kwargs["vectors_config"].size == 3
    client.upsert.assert_called_once()


def test_qdrant_adapter_filters_every_query_by_tenant(monkeypatch) -> None:
    client = MagicMock()
    client.collection_exists.return_value = True
    client.query_points.return_value.points = []
    monkeypatch.setattr("app.services.vector_store.QdrantClient", lambda **_kwargs: client)
    store = QdrantVectorStore(_settings())

    store.search(tenant_id="acme", vector=[0.0, 1.0, 0.0], limit=4)

    query_filter = client.query_points.call_args.kwargs["query_filter"]
    assert query_filter.must[0].key == "tenant_id"
    assert query_filter.must[0].match.value == "acme"


def test_every_filtered_field_is_indexed_before_a_query_uses_it(monkeypatch) -> None:
    """Qdrant answers a filter on an unindexed field with a 400, not a scan.

    Without this the product fails only once a document has been indexed and a
    question is asked — past every test that mocks the client and past a
    readiness check that never filters.
    """
    client = MagicMock()
    client.collection_exists.return_value = False
    client.query_points.return_value.points = []
    monkeypatch.setattr("app.services.vector_store.QdrantClient", lambda **_kwargs: client)
    store = QdrantVectorStore(_settings())

    store.search(tenant_id="acme", vector=[0.0, 1.0, 0.0], limit=4)

    indexed = {call.kwargs["field_name"] for call in client.create_payload_index.call_args_list}
    assert {"tenant_id", "document_id"} <= indexed


def test_a_collection_made_without_indexes_is_repaired_rather_than_left_broken(
    monkeypatch,
) -> None:
    """The collection already exists, so creation is skipped — indexing is not.

    A collection created before these indexes were declared would otherwise
    fail every search forever, since the creation branch never runs again.
    """
    client = MagicMock()
    client.collection_exists.return_value = True
    client.query_points.return_value.points = []
    monkeypatch.setattr("app.services.vector_store.QdrantClient", lambda **_kwargs: client)
    store = QdrantVectorStore(_settings())

    store.search(tenant_id="acme", vector=[0.0, 1.0, 0.0], limit=4)

    client.create_collection.assert_not_called()
    assert client.create_payload_index.call_count == 2


def test_collection_setup_is_not_repeated_for_every_operation(monkeypatch) -> None:
    """Setup is durable, so paying a round trip per read would buy nothing."""
    client = MagicMock()
    client.collection_exists.return_value = True
    client.query_points.return_value.points = []
    monkeypatch.setattr("app.services.vector_store.QdrantClient", lambda **_kwargs: client)
    store = QdrantVectorStore(_settings())

    for _ in range(3):
        store.search(tenant_id="acme", vector=[0.0, 1.0, 0.0], limit=4)

    assert client.collection_exists.call_count == 1
    assert client.query_points.call_count == 3
