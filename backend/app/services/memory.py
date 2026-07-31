"""Tenant-filtered long-term conversation memory.

Both writing and recall take an explicit `tenant_id`. An earlier version read
the tenant from configuration, which meant every organization recalled from the
same pool — the caller must now say whose memory it is asking for.
"""

from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient, models

from app.core.config import Settings
from app.services.embeddings import build_embedding_provider


class ConversationMemory:
    """Store completed question/answer pairs separately from document evidence."""

    def __init__(self, settings: Settings) -> None:
        if not settings.qdrant_url or not settings.qdrant_api_key:
            raise ValueError("Qdrant is not configured")
        self.collection = f"{settings.qdrant_collection}_memory"
        self.dimensions = settings.embedding_dimensions
        self._prepared = False
        self.embeddings = build_embedding_provider(settings)
        self.client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key.get_secret_value(),
            prefer_grpc=settings.qdrant_prefer_grpc,
            timeout=settings.run_timeout_seconds,
        )

    def remember(self, *, tenant_id: str, question: str, answer: str) -> None:
        text = f"Earlier question: {question}\nEarlier answer: {answer}"
        vector = self.embeddings.embed([text])[0]
        self._ensure_collection()
        self.client.upsert(
            collection_name=self.collection,
            wait=True,
            points=[
                models.PointStruct(
                    id=str(uuid5(NAMESPACE_URL, f"memory:{tenant_id}:{question}:{answer}")),
                    vector=vector,
                    payload={"tenant_id": tenant_id, "content": text},
                )
            ],
        )

    def recall(self, question: str, limit: int = 3, *, tenant_id: str) -> list[str]:
        if not tenant_id.strip():
            raise ValueError("tenant_id must not be empty")
        vector = self.embeddings.embed([question])[0]
        self._ensure_collection()
        response = self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="tenant_id",
                        match=models.MatchValue(value=tenant_id),
                    )
                ]
            ),
            limit=limit,
            with_payload=True,
        )
        return [
            str(point.payload["content"])
            for point in response.points
            if point.payload and isinstance(point.payload.get("content"), str)
        ]

    def _ensure_collection(self) -> None:
        """Create the collection and the `tenant_id` index `recall` filters on.

        Without the index Qdrant answers the recall filter with a 400. Recall
        failures are swallowed by the caller so a lost follow-up hint never
        fails an otherwise good answer — which means a missing index disables
        memory permanently and silently, with nothing surfacing to say so.
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
        self.client.create_payload_index(
            collection_name=self.collection,
            field_name="tenant_id",
            field_schema=models.PayloadSchemaType.KEYWORD,
            wait=True,
        )
        self._prepared = True
