"""Development-only document upload endpoint for the fixed demo tenant."""

from uuid import uuid4

import httpx
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import APIRouter, File, HTTPException, UploadFile, status
from pydantic import BaseModel

from app.core.config import Settings, get_settings
from app.ingestion.extraction import (
    DocumentExtractionError,
    extract_document_text,
    is_supported_document,
)
from app.ingestion.factory import build_document_ingestion_service
from app.services.object_storage import ObjectStorage

router = APIRouter()
UPLOAD_FILE = File(...)


class UploadedDocument(BaseModel):
    id: str
    filename: str
    chunks: int


def _demo_settings() -> Settings:
    settings = get_settings()
    if settings.app_env != "development" or not settings.enable_unauthenticated_demo_api:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return settings


@router.post("/documents", status_code=status.HTTP_201_CREATED, response_model=UploadedDocument)
async def upload_document(file: UploadFile = UPLOAD_FILE) -> UploadedDocument:
    """Store and index one bounded UTF-8 text document for the local demo tenant."""
    settings = _demo_settings()
    filename = file.filename or ""
    if not is_supported_document(filename):
        raise HTTPException(
            status_code=415,
            detail="Supported formats: PDF, DOCX, XLSX, TXT, Markdown, CSV, TSV, JSON, and HTML",
        )
    raw = await file.read(settings.demo_max_upload_bytes + 1)
    if len(raw) > settings.demo_max_upload_bytes:
        raise HTTPException(status_code=413, detail="The document exceeds the upload limit")
    try:
        content = extract_document_text(filename=filename, content=raw)
    except DocumentExtractionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    document_id = uuid4()
    try:
        ObjectStorage(settings).put_document(
            tenant_id=settings.demo_tenant_id,
            document_id=document_id,
            filename=filename,
            content=raw,
            content_type=file.content_type or "application/octet-stream",
        )
        chunks = build_document_ingestion_service(settings).ingest_text(
            tenant_id=settings.demo_tenant_id,
            document_id=str(document_id),
            filename=filename,
            content=content,
        )
    except (
        BotoCoreError,
        ClientError,
        httpx.HTTPError,
        RuntimeError,
        ValueError,
    ) as exc:
        raise HTTPException(
            status_code=503, detail="Document services are temporarily unavailable"
        ) from exc
    return UploadedDocument(id=str(document_id), filename=filename, chunks=chunks)
