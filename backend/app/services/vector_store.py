"""Qdrant adapter for tenant-isolated chunk storage and retrieval."""

from qdrant_client import QdrantClient, models

from app.core.config import Settings
from app.ingestion.service import SearchResult, VectorPoint

# Payload fields the queries below filter on. Qdrant rejects a filter on an
# unindexed field with a 400 rather than falling back to a scan, so these
# indexes are what make search and delete work at all, not a tuning knob.
# `tenant_id` carries the isolation guarantee and `document_id` narrows a
# delete, and both are exact-match strings, hence the keyword schema.
_FILTERED_PAYLOAD_FIELDS = ("tenant_id", "document_id")


class QdrantVectorStore:
    """Manage one fixed-dimension collection and filter every search by tenant."""

    def __init__(self, settings: Settings) -> None:
        if not settings.qdrant_url or not settings.qdrant_api_key:
            raise ValueError("QDRANT_URL and QDRANT_API_KEY are required for document ingestion")
        self.collection = settings.qdrant_collection
        self.dimensions = settings.embedding_dimensions
        self._prepared = False
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
        """Create the collection and the payload indexes its filters require.

        Cached per instance: every read and write calls this, and a collection
        outlives the process, so re-checking on each operation spends a round
        trip to learn what the first one already established.
        """
        if self._prepared:
            return
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(
                    size=self.dimensions,
                    distance=models.Distance.COSINE,
                ),
            )
        # Deliberately outside the branch above. Creating an index that already
        # exists is a no-op, so this also repairs a collection created before
        # these indexes were declared, rather than leaving every search against
        # it failing on a 400 that reads like a client bug.
        for field in _FILTERED_PAYLOAD_FIELDS:
            self.client.create_payload_index(
                collection_name=self.collection,
                field_name=field,
                field_schema=models.PayloadSchemaType.KEYWORD,
                wait=True,
            )
        self._prepared = True
