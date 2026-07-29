"""Tenant-isolated document ingestion and similarity-search orchestration."""

from dataclasses import dataclass
from typing import Protocol
from uuid import NAMESPACE_URL, uuid5

from app.ingestion.chunking import chunk_text


@dataclass(frozen=True)
class VectorPoint:
    """One embedded chunk ready for a vector-store adapter."""

    id: str
    vector: list[float]
    tenant_id: str
    document_id: str
    filename: str
    chunk_index: int
    content: str


@dataclass(frozen=True)
class SearchResult:
    """A chunk returned from a tenant-filtered similarity query."""

    document_id: str
    filename: str
    chunk_index: int
    content: str
    score: float


class EmbeddingProvider(Protocol):
    def embed(self, texts: list[str]) -> list[list[float]]: ...


class VectorStore(Protocol):
    def upsert(self, points: list[VectorPoint]) -> None: ...

    def search(self, *, tenant_id: str, vector: list[float], limit: int) -> list[SearchResult]: ...


class DocumentIngestionService:
    """Chunk documents, embed them, and keep every retrieval tenant-scoped."""

    def __init__(
        self,
        *,
        embeddings: EmbeddingProvider,
        vector_store: VectorStore,
        chunk_size: int = 1000,
        chunk_overlap: int = 150,
        embedding_dimensions: int = 768,
    ) -> None:
        self.embeddings = embeddings
        self.vector_store = vector_store
        self.chunk_size = chunk_size
        self.chunk_overlap = chunk_overlap
        self.embedding_dimensions = embedding_dimensions

    def ingest_text(
        self, *, tenant_id: str, document_id: str, filename: str, content: str
    ) -> int:
        """Index non-empty text and return the number of stored chunks."""
        self._validate_identity(tenant_id=tenant_id, document_id=document_id, filename=filename)
        chunks = chunk_text(
            content, chunk_size=self.chunk_size, chunk_overlap=self.chunk_overlap
        )
        if not chunks:
            raise ValueError("document content must not be empty")

        vectors = self.embeddings.embed(chunks)
        self._validate_vectors(vectors, expected_count=len(chunks))
        points = [
            VectorPoint(
                id=str(uuid5(NAMESPACE_URL, f"{tenant_id}:{document_id}:{index}")),
                vector=vector,
                tenant_id=tenant_id,
                document_id=document_id,
                filename=filename,
                chunk_index=index,
                content=chunk,
            )
            for index, (chunk, vector) in enumerate(zip(chunks, vectors, strict=True))
        ]
        self.vector_store.upsert(points)
        return len(points)

    def search(self, *, tenant_id: str, query: str, limit: int = 4) -> list[SearchResult]:
        """Return only chunks belonging to ``tenant_id`` for a non-empty query."""
        if not tenant_id.strip():
            raise ValueError("tenant_id must not be empty")
        if not query.strip():
            raise ValueError("query must not be empty")
        if limit < 1:
            raise ValueError("limit must be at least one")

        vectors = self.embeddings.embed([query.strip()])
        self._validate_vectors(vectors, expected_count=1)
        return self.vector_store.search(tenant_id=tenant_id, vector=vectors[0], limit=limit)

    def _validate_vectors(self, vectors: list[list[float]], *, expected_count: int) -> None:
        if len(vectors) != expected_count:
            raise RuntimeError("embedding provider returned an unexpected number of vectors")
        if any(len(vector) != self.embedding_dimensions for vector in vectors):
            raise RuntimeError("embedding provider returned an unexpected vector dimension")

    @staticmethod
    def _validate_identity(*, tenant_id: str, document_id: str, filename: str) -> None:
        if not tenant_id.strip() or not document_id.strip() or not filename.strip():
            raise ValueError("tenant_id, document_id, and filename must not be empty")
