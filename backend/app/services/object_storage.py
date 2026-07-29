"""Object-storage adapter for uploaded source documents."""

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

    def put_document(
        self,
        *,
        tenant_id: str,
        document_id: UUID,
        filename: str,
        content: bytes,
        content_type: str,
    ) -> str:
        """Store an upload under a server-owned, non-user-controlled key."""
        key = object_key(tenant_id=tenant_id, document_id=document_id, filename=filename)
        self.client.put_object(
            Bucket=self.bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
        )
        return key

    def get_document(self, key: str) -> bytes:
        """Read one stored object back for out-of-band processing."""
        response = self.client.get_object(Bucket=self.bucket, Key=key)
        return bytes(response["Body"].read())

    def delete_document(self, key: str) -> None:
        self.client.delete_object(Bucket=self.bucket, Key=key)


def object_key(*, tenant_id: str, document_id: UUID, filename: str) -> str:
    """Build a key from values the server controls.

    The uploaded filename contributes only characters that survive this filter,
    and it is never the leading path segment, so a name like `../../etc/passwd`
    cannot escape the tenant prefix.
    """
    safe_name = "".join(char for char in filename if char.isalnum() or char in ".-_")
    return f"{tenant_id}/{document_id}/{safe_name.lstrip('.') or 'document.txt'}"
