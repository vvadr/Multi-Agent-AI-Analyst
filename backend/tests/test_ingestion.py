from math import sqrt

import pytest

from app.ingestion.chunking import chunk_text
from app.ingestion.service import (
    DocumentIngestionService,
    SearchResult,
    VectorPoint,
)


class KeywordEmbeddings:
    """Deterministic three-dimensional embeddings for service-level tests."""

    def embed(self, texts: list[str]) -> list[list[float]]:
        vectors = []
        for text in texts:
            words = set(text.lower().split())
            vectors.append(
                [
                    float("revenue" in words),
                    float("sustainability" in words),
                    float("hiring" in words),
                ]
            )
        return vectors


class InMemoryVectorStore:
    def __init__(self) -> None:
        self.points: list[VectorPoint] = []

    def upsert(self, points: list[VectorPoint]) -> None:
        indexed = {point.id: point for point in self.points}
        indexed.update({point.id: point for point in points})
        self.points = list(indexed.values())

    def search(self, *, tenant_id: str, vector: list[float], limit: int) -> list[SearchResult]:
        def score(point: VectorPoint) -> float:
            numerator = sum(left * right for left, right in zip(point.vector, vector, strict=True))
            denominator = sqrt(sum(value * value for value in point.vector)) * sqrt(
                sum(value * value for value in vector)
            )
            return numerator / denominator if denominator else 0.0

        matches = [point for point in self.points if point.tenant_id == tenant_id]
        return [
            SearchResult(
                document_id=point.document_id,
                filename=point.filename,
                chunk_index=point.chunk_index,
                content=point.content,
                score=score(point),
            )
            for point in sorted(matches, key=score, reverse=True)[:limit]
        ]


def _service(store: InMemoryVectorStore) -> DocumentIngestionService:
    return DocumentIngestionService(
        embeddings=KeywordEmbeddings(),
        vector_store=store,
        chunk_size=100,
        chunk_overlap=10,
        embedding_dimensions=3,
    )


def test_chunk_text_creates_overlapping_whitespace_boundaries() -> None:
    chunks = chunk_text("alpha bravo charlie delta echo foxtrot", chunk_size=18, chunk_overlap=6)

    assert chunks == [
        "alpha bravo",
        "bravo charlie",
        "charlie delta echo",
        "delta echo foxtrot",
    ]


def test_document_ingestion_and_similarity_search_are_tenant_isolated() -> None:
    store = InMemoryVectorStore()
    service = _service(store)
    service.ingest_text(
        tenant_id="acme",
        document_id="acme-report",
        filename="report.txt",
        content="Revenue grew through sustainability investments.",
    )
    service.ingest_text(
        tenant_id="other-company",
        document_id="other-report",
        filename="private.txt",
        content="Revenue grew through hiring.",
    )

    results = service.search(tenant_id="acme", query="sustainability revenue")

    assert len(results) == 1
    assert results[0].document_id == "acme-report"
    assert "sustainability" in results[0].content.lower()
    acme_points = [point for point in store.points if point.document_id == "acme-report"]
    assert all(point.tenant_id == "acme" for point in acme_points)


def test_ingestion_rejects_an_embedding_dimension_mismatch() -> None:
    service = DocumentIngestionService(
        embeddings=KeywordEmbeddings(),
        vector_store=InMemoryVectorStore(),
        embedding_dimensions=768,
    )

    with pytest.raises(RuntimeError, match="vector dimension"):
        service.ingest_text(
            tenant_id="acme",
            document_id="report",
            filename="report.txt",
            content="Revenue",
        )


def test_search_rejects_an_empty_query() -> None:
    with pytest.raises(ValueError, match="query"):
        _service(InMemoryVectorStore()).search(tenant_id="acme", query="  ")
