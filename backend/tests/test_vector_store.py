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
