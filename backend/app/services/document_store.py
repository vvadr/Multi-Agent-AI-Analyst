"""Durable persistence for uploaded documents and their ingestion lifecycle.

The row is created before a single byte reaches object storage. That ordering is
what turns a crash mid-upload into a `failed` record an operator can reconcile,
rather than an object in a bucket that no table knows about.

As in `run_store`, every lookup takes an `organization_id` and filters on it.
"""

from __future__ import annotations

from datetime import UTC, datetime
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import Document

# Stable, non-revealing categories. These are stored and logged; they are never
# provider text, and the browser sees copy chosen from the HTTP status instead.
FAILURE_EXTRACTION = "extraction_failed"
FAILURE_INDEXING = "indexing_failed"
FAILURE_STORAGE = "storage_failed"


def _utc_now() -> datetime:
    return datetime.now(UTC)


def create_document(
    session: Session,
    *,
    document_id: UUID,
    organization_id: UUID,
    user_id: UUID | None,
    filename: str,
    content_type: str,
    byte_size: int,
    content_hash: str,
    object_key: str,
) -> Document:
    """Create the row with a caller-supplied id.

    The id is generated before the storage key is built, and both must agree —
    letting the model default assign a different one would store the bytes
    under a key the row does not reference.
    """
    document = Document(
        id=document_id,
        organization_id=organization_id,
        uploaded_by_user_id=user_id,
        filename=filename[:255],
        content_type=content_type[:255],
        byte_size=byte_size,
        content_hash=content_hash,
        object_key=object_key,
        status="pending",
    )
    session.add(document)
    session.commit()
    return document


def get_document(
    session: Session, *, organization_id: UUID, document_id: UUID
) -> Document | None:
    return session.scalar(
        select(Document).where(
            Document.id == document_id,
            Document.organization_id == organization_id,
            Document.status != "deleted",
        )
    )


def list_documents(session: Session, *, organization_id: UUID, limit: int = 100) -> list[Document]:
    return list(
        session.scalars(
            select(Document)
            .where(Document.organization_id == organization_id, Document.status != "deleted")
            .order_by(Document.created_at.desc())
            .limit(limit)
        )
    )


def mark_processing(session: Session, *, document: Document) -> None:
    document.status = "processing"
    session.commit()


def mark_ready(session: Session, *, document: Document, chunk_count: int) -> None:
    document.status = "ready"
    document.chunk_count = chunk_count
    document.failure_reason = None
    session.commit()


def mark_failed(session: Session, *, document: Document, reason: str) -> None:
    document.status = "failed"
    document.failure_reason = reason
    session.commit()


def mark_deleted(session: Session, *, document: Document) -> None:
    """Tombstone the row so the id can never be reused or re-listed."""
    document.status = "deleted"
    document.chunk_count = 0
    session.commit()


def stale_processing(session: Session, *, older_than: datetime) -> list[Document]:
    """Documents whose worker died mid-ingestion."""
    return list(
        session.scalars(
            select(Document).where(
                Document.status.in_(("pending", "processing")),
                Document.updated_at < older_than,
            )
        )
    )
