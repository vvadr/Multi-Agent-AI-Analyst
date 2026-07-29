"""Explicit development CLI for proving Phase 1 document ingestion end to end."""

import argparse
from pathlib import Path

from app.core.config import get_settings
from app.ingestion.factory import build_document_ingestion_service


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Embed and index one UTF-8 text document.")
    parser.add_argument("path", type=Path, help="Path to a UTF-8 plain-text document")
    parser.add_argument("--tenant-id", required=True, help="Server-authorized tenant identifier")
    parser.add_argument("--document-id", required=True, help="Stable document identifier")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    try:
        content = args.path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise SystemExit(f"Could not read the supplied UTF-8 text document: {exc}") from None

    service = build_document_ingestion_service(get_settings())
    count = service.ingest_text(
        tenant_id=args.tenant_id,
        document_id=args.document_id,
        filename=args.path.name,
        content=content,
    )
    print(f"Indexed {count} chunks from {args.path.name}.")


if __name__ == "__main__":
    main()
