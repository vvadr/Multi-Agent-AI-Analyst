"""Authenticated document upload, listing, and deletion.

The request path does as little as possible: validate, store the bytes, write a
row, enqueue. Parsing untrusted files and talking to embedding providers both
happen in the worker, so neither a malicious document nor a slow provider can
occupy a web process.

Ownership is never taken from the request. Every row is written and read with
the organization from the caller's verified access token.
"""

from hashlib import sha256
from typing import Annotated
from uuid import UUID, uuid4

from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, Depends, File, HTTPException, Request, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import get_job_queue, get_rate_limiter
from app.auth.dependencies import get_current_principal
from app.auth.service import Principal
from app.core.config import get_settings
from app.db.session import get_session
from app.ingestion.extraction import is_supported_document
from app.services import document_store
from app.services.object_storage import ObjectStorage, object_key
from app.services.queue import JOB_INGEST_DOCUMENT
from app.services.rate_limit import enforce, rate_limit_key

router = APIRouter()
UPLOAD_FILE = File(...)

DbSession = Annotated[Session, Depends(get_session)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]

_ONE_HOUR = 60 * 60


class DocumentResponse(BaseModel):
    id: str
    filename: str
    status: str
    chunks: int


class DocumentListResponse(BaseModel):
    documents: list[DocumentResponse]


@router.post(
    "/documents", status_code=status.HTTP_202_ACCEPTED, response_model=DocumentResponse
)
async def upload_document(
    request: Request,
    principal: CurrentPrincipal,
    session: DbSession,
    file: UploadFile = UPLOAD_FILE,
) -> DocumentResponse:
    """Accept one document and queue it for indexing.

    Answers 202, not 201: the bytes are safe but nothing is searchable yet. The
    client polls the returned id, or lists documents, to watch it become ready.
    """
    settings = get_settings()
    enforce(
        get_rate_limiter(),
        settings=settings,
        key=rate_limit_key("upload", "organization", str(principal.organization_id)),
        limit=settings.rate_limit_uploads_per_hour,
        window_seconds=_ONE_HOUR,
        unavailable="reject",
    )

    filename = file.filename or ""
    if not is_supported_document(filename):
        raise HTTPException(
            status_code=415,
            detail="Supported formats: PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, and HTML",
        )
    raw = await file.read(settings.max_upload_bytes + 1)
    if len(raw) > settings.max_upload_bytes:
        raise HTTPException(status_code=413, detail="The document exceeds the upload limit")
    if not raw:
        raise HTTPException(status_code=422, detail="The document is empty")

    tenant_id = str(principal.organization_id)
    document_id = uuid4()
    key = object_key(tenant_id=tenant_id, document_id=document_id, filename=filename)

    # The row is written first so a crash after this point leaves a record to
    # reconcile rather than an unreferenced object in the bucket.
    document = document_store.create_document(
        session,
        document_id=document_id,
        organization_id=principal.organization_id,
        user_id=principal.user_id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        byte_size=len(raw),
        content_hash=sha256(raw).hexdigest(),
        object_key=key,
    )
    try:
        ObjectStorage(settings).put_document(
            tenant_id=tenant_id,
            document_id=document.id,
            filename=filename,
            content=raw,
            content_type=file.content_type or "application/octet-stream",
        )
    except (BotoCoreError, ClientError, ValueError) as exc:
        document_store.mark_failed(
            session, document=document, reason=document_store.FAILURE_STORAGE
        )
        raise HTTPException(
            status_code=503, detail="Document services are temporarily unavailable"
        ) from exc

    try:
        get_job_queue().enqueue(JOB_INGEST_DOCUMENT, {"document_id": str(document.id)})
    except Exception as exc:
        # The row stays `pending`; the worker's stranded-row sweep will pick it
        # up once the queue is reachable again, so the upload is not lost.
        raise HTTPException(
            status_code=503, detail="Document services are temporarily unavailable"
        ) from exc

    return _serialize(document.id, document.filename, document.status, document.chunk_count)


@router.get("/documents", response_model=DocumentListResponse)
def list_documents(principal: CurrentPrincipal, session: DbSession) -> DocumentListResponse:
    documents = document_store.list_documents(
        session, organization_id=principal.organization_id
    )
    return DocumentListResponse(
        documents=[
            _serialize(item.id, item.filename, item.status, item.chunk_count)
            for item in documents
        ]
    )


@router.get("/documents/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: UUID, principal: CurrentPrincipal, session: DbSession
) -> DocumentResponse:
    document = document_store.get_document(
        session, organization_id=principal.organization_id, document_id=document_id
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    return _serialize(document.id, document.filename, document.status, document.chunk_count)


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: UUID, principal: CurrentPrincipal, session: DbSession
) -> None:
    """Remove a document from the row, the bucket, and the vector index.

    The tombstone is written last. If either external delete fails the row stays
    visible and the caller can retry, which is preferable to a document that has
    vanished from the UI but is still answering questions.
    """
    document = document_store.get_document(
        session, organization_id=principal.organization_id, document_id=document_id
    )
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")

    settings = get_settings()
    try:
        ObjectStorage(settings).delete_document(document.object_key)
        _delete_document_vectors(
            settings,
            tenant_id=str(principal.organization_id),
            document_id=str(document.id),
        )
    except (BotoCoreError, ClientError, ValueError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503, detail="Document services are temporarily unavailable"
        ) from exc
    document_store.mark_deleted(session, document=document)


def _delete_document_vectors(settings, *, tenant_id: str, document_id: str) -> None:
    from app.services.vector_store import QdrantVectorStore

    QdrantVectorStore(settings).delete_document(tenant_id=tenant_id, document_id=document_id)


def _serialize(
    document_id: UUID, filename: str, status_value: str, chunks: int
) -> DocumentResponse:
    return DocumentResponse(
        id=str(document_id), filename=filename, status=status_value, chunks=chunks
    )
