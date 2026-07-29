"""Qdrant adapter for tenant-isolated chunk storage and retrieval."""

from qdrant_client import QdrantClient, models

from app.core.config import Settings
from app.ingestion.service import SearchResult, VectorPoint


class QdrantVectorStore:
    """Manage one fixed-dimension collection and filter every search by tenant."""

    def __init__(self, settings: Settings) -> None:
        if not settings.qdrant_url or not settings.qdrant_api_key:
            raise ValueError("QDRANT_URL and QDRANT_API_KEY are required for document ingestion")
        self.collection = settings.qdrant_collection
        self.dimensions = settings.embedding_dimensions
        self.client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key.get_secret_value(),
            prefer_grpc=settings.qdrant_prefer_grpc,
            timeout=settings.service_probe_timeout_seconds,
        )

    def upsert(self, points: list[VectorPoint]) -> None:
        if not points:
            return
        self._ensure_collection()
        self.client.upsert(
            collection_name=self.collection,
            wait=True,
            points=[
                models.PointStruct(
                    id=point.id,
                    vector=point.vector,
                    payload={
                        "tenant_id": point.tenant_id,
                        "document_id": point.document_id,
                        "filename": point.filename,
                        "chunk_index": point.chunk_index,
                        "content": point.content,
                    },
                )
                for point in points
            ],
        )

    def search(self, *, tenant_id: str, vector: list[float], limit: int) -> list[SearchResult]:
        self._ensure_collection()
        response = self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="tenant_id", match=models.MatchValue(value=tenant_id)
                    )
                ]
            ),
            limit=limit,
            with_payload=True,
        )
        results: list[SearchResult] = []
        for point in response.points:
            payload = point.payload or {}
            try:
                results.append(
                    SearchResult(
                        document_id=str(payload["document_id"]),
                        filename=str(payload["filename"]),
                        chunk_index=int(payload["chunk_index"]),
                        content=str(payload["content"]),
                        score=float(point.score),
                    )
                )
            except (KeyError, TypeError, ValueError):
                raise RuntimeError("vector store returned an invalid point payload") from None
        return results

    def delete_document(self, *, tenant_id: str, document_id: str) -> None:
        """Drop every chunk of one document belonging to one tenant.

        Both conditions are required. Filtering on `document_id` alone would let
        a caller who guesses an id delete another organization's vectors.
        """
        if not tenant_id.strip() or not document_id.strip():
            raise ValueError("tenant_id and document_id must not be empty")
        self._ensure_collection()
        self.client.delete(
            collection_name=self.collection,
            points_selector=models.FilterSelector(
                filter=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="tenant_id", match=models.MatchValue(value=tenant_id)
                        ),
                        models.FieldCondition(
                            key="document_id", match=models.MatchValue(value=document_id)
                        ),
                    ]
                )
            ),
            wait=True,
        )

    def close(self) -> None:
        self.client.close()

    def _ensure_collection(self) -> None:
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(
                    size=self.dimensions,
                    distance=models.Distance.COSINE,
                ),
            )
