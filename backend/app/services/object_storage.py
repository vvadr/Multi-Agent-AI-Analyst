"""Small object-storage adapter for the development document upload endpoint."""

from uuid import UUID

import boto3
from botocore.config import Config as BotoConfig

from app.core.config import Settings


class ObjectStorage:
    def __init__(self, settings: Settings) -> None:
        if (
            not settings.object_storage_endpoint
            or not settings.object_storage_access_key_id
            or not settings.object_storage_secret_access_key
        ):
            raise ValueError("object storage is not configured")
        self.bucket = settings.object_storage_bucket
        self.client = boto3.client(
            "s3",
            endpoint_url=settings.object_storage_endpoint,
            region_name=settings.object_storage_region,
            aws_access_key_id=settings.object_storage_access_key_id.get_secret_value(),
            aws_secret_access_key=settings.object_storage_secret_access_key.get_secret_value(),
            config=BotoConfig(
                connect_timeout=settings.run_timeout_seconds,
                read_timeout=settings.run_timeout_seconds,
                retries={"max_attempts": 0},
                s3={"addressing_style": "path"},
            ),
        )

    def put_text(self, *, tenant_id: str, document_id: UUID, filename: str, content: bytes) -> str:
        """Store a plain-text upload under a server-owned, non-user-controlled key."""
        safe_name = "".join(char for char in filename if char.isalnum() or char in ".-_")
        key = f"{tenant_id}/{document_id}/{safe_name or 'document.txt'}"
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType="text/plain; charset=utf-8",
        )
        return key
