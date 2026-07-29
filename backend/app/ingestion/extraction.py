"""Safe text extraction for the local document-upload pipeline."""

import csv
import io
import json
from html.parser import HTMLParser
from pathlib import PurePath

SUPPORTED_DOCUMENT_EXTENSIONS = frozenset(
    {".txt", ".md", ".csv", ".tsv", ".json", ".html", ".htm", ".pdf", ".docx", ".xlsx"}
)
MAX_EXTRACTED_CHARACTERS = 2_000_000


class DocumentExtractionError(ValueError):
    """A user-visible document cannot safely be converted to text."""


def is_supported_document(filename: str) -> bool:
    return PurePath(filename).suffix.lower() in SUPPORTED_DOCUMENT_EXTENSIONS


def extract_document_text(*, filename: str, content: bytes) -> str:
    """Extract bounded text from one supported upload without trusting its MIME type."""
    extension = PurePath(filename).suffix.lower()
    if extension not in SUPPORTED_DOCUMENT_EXTENSIONS:
        raise DocumentExtractionError("This document format is not supported")
    try:
        if extension in {".txt", ".md"}:
            text = content.decode("utf-8-sig")
        elif extension in {".csv", ".tsv"}:
            text = _extract_delimited(content, delimiter="\t" if extension == ".tsv" else ",")
        elif extension == ".json":
            text = json.dumps(json.loads(content.decode("utf-8-sig")), ensure_ascii=False, indent=2)
        elif extension in {".html", ".htm"}:
            text = _extract_html(content)
        elif extension == ".pdf":
            text = _extract_pdf(content)
        elif extension == ".docx":
            text = _extract_docx(content)
        else:
            text = _extract_xlsx(content)
    except DocumentExtractionError:
        raise
    except Exception as exc:
        # Parser-specific failures (including malformed PDFs and malformed
        # Office archives) are never exposed directly to API clients.
        raise DocumentExtractionError("The document could not be read as valid content") from exc
    normalized = "\n".join(line.strip() for line in text.splitlines() if line.strip())
    if not normalized:
        raise DocumentExtractionError("The document contains no readable text")
    if len(normalized) > MAX_EXTRACTED_CHARACTERS:
        raise DocumentExtractionError("The extracted document text is too large to index")
    return normalized


def _extract_delimited(content: bytes, *, delimiter: str) -> str:
    rows = csv.reader(io.StringIO(content.decode("utf-8-sig")), delimiter=delimiter)
    return "\n".join(" | ".join(cell.strip() for cell in row) for row in rows)


class _TextCollector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def _extract_html(content: bytes) -> str:
    parser = _TextCollector()
    parser.feed(content.decode("utf-8-sig"))
    parser.close()
    return "\n".join(parser.parts)


def _extract_pdf(content: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(content))
    if reader.is_encrypted:
        raise DocumentExtractionError("Password-protected PDFs are not supported")
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(content: bytes) -> str:
    from docx import Document

    document = Document(io.BytesIO(content))
    parts = [paragraph.text for paragraph in document.paragraphs]
    parts.extend(
        " | ".join(cell.text for cell in row.cells)
        for table in document.tables
        for row in table.rows
    )
    return "\n".join(parts)


def _extract_xlsx(content: bytes) -> str:
    from openpyxl import load_workbook

    workbook = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
    parts: list[str] = []
    for worksheet in workbook.worksheets:
        parts.append(f"Sheet: {worksheet.title}")
        for row in worksheet.iter_rows(values_only=True):
            values = [str(value) for value in row if value is not None]
            if values:
                parts.append(" | ".join(values))
    return "\n".join(parts)
