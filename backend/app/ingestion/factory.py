"""Construction of the production ingestion service from application settings."""

from app.core.config import Settings
from app.ingestion.service import DocumentIngestionService
from app.services.embeddings import build_embedding_provider
from app.services.vector_store import QdrantVectorStore


def build_document_ingestion_service(settings: Settings) -> DocumentIngestionService:
    """Create the configured embedding and Qdrant adapters for ingestion jobs."""
    return DocumentIngestionService(
        embeddings=build_embedding_provider(settings),
        vector_store=QdrantVectorStore(settings),
        embedding_dimensions=settings.embedding_dimensions,
    )
