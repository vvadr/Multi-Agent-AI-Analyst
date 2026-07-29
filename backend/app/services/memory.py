"""Tenant-filtered long-term conversation memory for the local demo."""

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
        self.tenant_id = settings.demo_tenant_id
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

    def recall(self, question: str, limit: int = 3) -> list[str]:
        vector = self.embeddings.embed([question])[0]
        self._ensure_collection()
        response = self.client.query_points(
            collection_name=self.collection,
            query=vector,
            query_filter=models.Filter(
                must=[
                    models.FieldCondition(
                        key="tenant_id",
                        match=models.MatchValue(value=self.tenant_id),
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
        if not self.client.collection_exists(self.collection):
            self.client.create_collection(
                collection_name=self.collection,
                vectors_config=models.VectorParams(
                    size=self.dimensions,
                    distance=models.Distance.COSINE,
                ),
            )
