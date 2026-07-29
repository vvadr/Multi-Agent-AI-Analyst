import io
import json
import zipfile

import pytest
from docx import Document
from openpyxl import Workbook
from pypdf import PdfWriter

from app.ingestion.extraction import (
    DocumentExtractionError,
    extract_document_text,
    is_supported_document,
)


@pytest.mark.parametrize(
    ("filename", "content", "expected"),
    [
        ("report.txt", b"Sustainability priority", "Sustainability"),
        ("report.md", b"# Priority\nSustainability", "Priority"),
        ("metrics.csv", b"region,revenue\nEast,125000", "125000"),
        ("payload.json", json.dumps({"region": "East"}).encode(), "East"),
        ("page.html", b"<h1>Report</h1><p>Priority</p>", "Priority"),
    ],
)
def test_extracts_supported_text_formats(filename: str, content: bytes, expected: str) -> None:
    assert expected in extract_document_text(filename=filename, content=content)


def test_extracts_docx_and_xlsx() -> None:
    docx = Document()
    docx.add_paragraph("Sustainability priority")
    docx_buffer = io.BytesIO()
    docx.save(docx_buffer)

    workbook = Workbook()
    workbook.active.append(["region", "revenue"])
    workbook.active.append(["East", 125000])
    xlsx_buffer = io.BytesIO()
    workbook.save(xlsx_buffer)

    assert "Sustainability" in extract_document_text(
        filename="report.docx", content=docx_buffer.getvalue()
    )
    extracted_xlsx = extract_document_text(
        filename="metrics.xlsx", content=xlsx_buffer.getvalue()
    )
    assert "125000" in extracted_xlsx


def test_rejects_encrypted_pdf_and_unsupported_format() -> None:
    writer = PdfWriter()
    writer.add_blank_page(width=100, height=100)
    writer.encrypt("secret")
    pdf = io.BytesIO()
    writer.write(pdf)

    with pytest.raises(DocumentExtractionError, match="Password-protected"):
        extract_document_text(filename="locked.pdf", content=pdf.getvalue())
    assert not is_supported_document("legacy.doc")


# --------------------------------------------------- adversarial archives


def _zip_bomb(*, members: int = 1, member_bytes: int = 50_000_000) -> bytes:
    """A small archive whose members claim to decompress to a great deal."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for index in range(members):
            # Highly compressible: kilobytes on disk, megabytes expanded.
            archive.writestr(f"part-{index}.xml", b"\0" * member_bytes)
    return buffer.getvalue()


def test_an_expansion_bomb_is_refused_before_it_is_decompressed() -> None:
    with pytest.raises(DocumentExtractionError, match="unsafe size"):
        extract_document_text(filename="bomb.docx", content=_zip_bomb())


def test_an_archive_with_too_many_members_is_refused() -> None:
    payload = _zip_bomb(members=40, member_bytes=16)

    with pytest.raises(DocumentExtractionError, match="too many internal parts"):
        extract_document_text(
            filename="many.xlsx", content=payload, max_archive_members=8
        )


def test_the_expansion_ratio_is_configurable() -> None:
    payload = _zip_bomb(members=1, member_bytes=200_000)

    # Permissive enough to admit it, then strict enough to refuse it.
    with pytest.raises(DocumentExtractionError, match="unsafe size"):
        extract_document_text(
            filename="ratio.docx", content=payload, max_expansion_ratio=1
        )


def test_an_encrypted_office_archive_is_refused() -> None:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("word/document.xml", b"content")
    raw = bytearray(buffer.getvalue())
    # Set the encryption flag in the local file header and central directory.
    for marker in (b"PK\x03\x04", b"PK\x01\x02"):
        offset = raw.find(marker)
        flag_offset = offset + (6 if marker == b"PK\x03\x04" else 8)
        raw[flag_offset] |= 0x1

    with pytest.raises(DocumentExtractionError, match="Password-protected"):
        extract_document_text(filename="locked.docx", content=bytes(raw))


def test_a_corrupt_office_archive_is_reported_as_unreadable() -> None:
    with pytest.raises(DocumentExtractionError, match="valid content"):
        extract_document_text(filename="broken.docx", content=b"not a zip file at all")


def test_extraction_stops_at_the_character_budget() -> None:
    oversized = ("a" * 100 + "\n").encode() * 200

    with pytest.raises(DocumentExtractionError, match="too large to index"):
        extract_document_text(
            filename="long.txt", content=oversized, max_characters=500
        )


def test_a_document_with_no_readable_text_is_refused() -> None:
    with pytest.raises(DocumentExtractionError, match="no readable text"):
        extract_document_text(filename="blank.txt", content=b"   \n\t  \n")


def test_the_character_budget_admits_a_document_within_it() -> None:
    text = extract_document_text(
        filename="short.txt", content=b"a concise report", max_characters=1_000
    )

    assert text == "a concise report"
