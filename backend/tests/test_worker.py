"""Worker behaviour: completion, retry, terminal failure, and recovery.

The retry policy is the part worth pinning down. A transient provider outage
must leave the run recoverable, and only an exhausted queue may write a failure
the reader will see — otherwise attempt one of three presents itself as final.
"""

from __future__ import annotations

from collections.abc import Generator
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import uuid4

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app import worker as worker_module
from app.core.config import Settings
from app.db.base import Base
from app.db.models import Document, Organization, Run
from app.ingestion.extraction import DocumentExtractionError
from app.services import document_store, run_store
from app.services.queue import JOB_EXECUTE_RUN, JOB_INGEST_DOCUMENT, InMemoryJobQueue, Job
from app.worker import Worker


@dataclass
class Fixture:
    worker: Worker
    factory: sessionmaker[Session]
    queue: InMemoryJobQueue
    organization_id: Any


class _Recorder:
    """Stands in for every external service the worker touches."""

    def __init__(self) -> None:
        self.remembered: list[tuple[str, str]] = []
        self.ingested: list[dict[str, Any]] = []

    # generation / retrieval / memory -----------------------------------
    def generate(self, prompt: str) -> str:
        return "an answer"

    def search(self, *args: Any, **kwargs: Any) -> list[Any]:
        return []

    def recall(self, question: str, limit: int = 3, *, tenant_id: str) -> list[str]:
        return []

    def remember(self, *, tenant_id: str, question: str, answer: str) -> None:
        self.remembered.append((tenant_id, answer))

    def ingest_text(self, *, tenant_id: str, document_id: str, filename: str, content: str) -> int:
        self.ingested.append({"tenant_id": tenant_id, "document_id": document_id})
        return 4

    # object storage ----------------------------------------------------
    def get_document(self, key: str) -> bytes:
        return b"stored bytes"

    def flush(self) -> None:
        return None


@pytest.fixture
def fixture(monkeypatch: pytest.MonkeyPatch) -> Generator[Fixture, None, None]:
    settings = Settings(app_env="test", job_max_attempts=2)
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    recorder = _Recorder()

    monkeypatch.setattr(worker_module, "create_session", factory)
    monkeypatch.setattr(worker_module, "build_observability", lambda _: recorder)
    monkeypatch.setattr(
        worker_module, "build_text_generator", lambda *a, **k: _Generator(recorder)
    )
    monkeypatch.setattr(
        worker_module, "build_document_ingestion_service", lambda _: recorder
    )
    monkeypatch.setattr(worker_module, "ConversationMemory", lambda _: recorder)
    monkeypatch.setattr(worker_module, "TavilyWebSearch", lambda _: recorder)
    monkeypatch.setattr(worker_module, "ObjectStorage", lambda _: recorder)
    monkeypatch.setattr(
        worker_module,
        "extract_document_text",
        lambda **kwargs: "extracted text",
    )
    monkeypatch.setattr(
        worker_module,
        "run_workflow",
        lambda question, **kwargs: {
            "answer": "Revenue grew.",
            "citations": [
                {"id": "c1", "kind": "document", "title": "Report", "excerpt": "grew"}
            ],
        },
    )

    session = factory()
    organization = Organization(name="Test Org")
    session.add(organization)
    session.commit()
    organization_id = organization.id
    session.close()

    queue = InMemoryJobQueue(settings)
    yield Fixture(Worker(settings, queue), factory, queue, organization_id)
    Base.metadata.drop_all(engine)
    engine.dispose()


class _Generator:
    def __init__(self, recorder: _Recorder) -> None:
        self.generate = recorder.generate


def _make_run(fixture: Fixture) -> Run:
    session = fixture.factory()
    try:
        return run_store.create_run(
            session,
            organization_id=fixture.organization_id,
            user_id=None,
            question="What changed?",
        )
    finally:
        session.close()


def _make_document(fixture: Fixture) -> Document:
    session = fixture.factory()
    try:
        return document_store.create_document(
            session,
            document_id=uuid4(),
            organization_id=fixture.organization_id,
            user_id=None,
            filename="report.txt",
            content_type="text/plain",
            byte_size=12,
            content_hash="hash",
            object_key="key",
        )
    finally:
        session.close()


def _reload(fixture: Fixture, model, identifier):
    session = fixture.factory()
    try:
        return session.get(model, identifier)
    finally:
        session.close()


# ------------------------------------------------------------------ runs


def test_a_completed_run_stores_its_answer_and_citations(fixture: Fixture) -> None:
    run = _make_run(fixture)

    fixture.worker.handle(Job(id="j1", type=JOB_EXECUTE_RUN, payload={"run_id": str(run.id)}))

    stored = _reload(fixture, Run, run.id)
    assert stored.status == "completed"
    assert stored.answer == "Revenue grew."
    session = fixture.factory()
    try:
        assert len(run_store.citations_for(session, run_id=run.id)) == 1
    finally:
        session.close()


def test_memory_is_written_under_the_owning_organization(fixture: Fixture) -> None:
    run = _make_run(fixture)

    fixture.worker.handle(Job(id="j1", type=JOB_EXECUTE_RUN, payload={"run_id": str(run.id)}))

    session = fixture.factory()
    try:
        stored = session.get(Run, run.id)
        recorded_tenant = worker_module.ConversationMemory(None).remembered
    finally:
        session.close()
    assert recorded_tenant == [(str(stored.organization_id), "Revenue grew.")]


def test_a_failing_run_is_retried_before_it_is_reported_as_failed(
    fixture: Fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = _make_run(fixture)

    def explode(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(worker_module, "run_workflow", explode)

    fixture.worker.handle(Job(id="j1", type=JOB_EXECUTE_RUN, payload={"run_id": str(run.id)}))

    # First attempt: requeued, and the reader is not told anything is wrong.
    assert _reload(fixture, Run, run.id).status == "running"
    assert fixture.queue.claim(timeout_seconds=0) is not None


def test_a_run_is_marked_failed_once_retries_are_exhausted(
    fixture: Fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    run = _make_run(fixture)

    def explode(*args: Any, **kwargs: Any) -> None:
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(worker_module, "run_workflow", explode)

    # attempts=1 with job_max_attempts=2 means this attempt is the last.
    fixture.worker.handle(
        Job(id="j1", type=JOB_EXECUTE_RUN, payload={"run_id": str(run.id)}, attempts=1)
    )

    stored = _reload(fixture, Run, run.id)
    assert stored.status == "failed"
    assert stored.error == run_store.RUN_FAILURE_MESSAGE
    # The message is fixed copy, never the provider's text.
    assert "provider unavailable" not in (stored.error or "")


def test_an_already_finished_run_is_not_executed_again(fixture: Fixture) -> None:
    run = _make_run(fixture)
    session = fixture.factory()
    try:
        run_store.mark_failed(session, run=session.get(Run, run.id))
    finally:
        session.close()

    fixture.worker.handle(Job(id="j1", type=JOB_EXECUTE_RUN, payload={"run_id": str(run.id)}))

    assert _reload(fixture, Run, run.id).status == "failed"


# ------------------------------------------------------------- documents


def test_an_ingested_document_becomes_ready_with_its_chunk_count(fixture: Fixture) -> None:
    document = _make_document(fixture)

    fixture.worker.handle(
        Job(id="j2", type=JOB_INGEST_DOCUMENT, payload={"document_id": str(document.id)})
    )

    stored = _reload(fixture, Document, document.id)
    assert stored.status == "ready"
    assert stored.chunk_count == 4


def test_ingestion_is_scoped_to_the_owning_organization(fixture: Fixture) -> None:
    document = _make_document(fixture)

    fixture.worker.handle(
        Job(id="j2", type=JOB_INGEST_DOCUMENT, payload={"document_id": str(document.id)})
    )

    ingested = worker_module.build_document_ingestion_service(None).ingested
    assert ingested[0]["tenant_id"] == str(fixture.organization_id)


def test_an_unreadable_document_fails_immediately_without_retrying(
    fixture: Fixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    document = _make_document(fixture)

    def reject(**kwargs: Any) -> str:
        raise DocumentExtractionError("unreadable")

    monkeypatch.setattr(worker_module, "extract_document_text", reject)

    fixture.worker.handle(
        Job(id="j2", type=JOB_INGEST_DOCUMENT, payload={"document_id": str(document.id)})
    )

    stored = _reload(fixture, Document, document.id)
    assert stored.status == "failed"
    assert stored.failure_reason == document_store.FAILURE_EXTRACTION
    # A file this parser cannot read will not become readable on attempt two.
    assert fixture.queue.claim(timeout_seconds=0) is None


# -------------------------------------------------------------- recovery


def test_stranded_work_is_requeued_on_startup(fixture: Fixture) -> None:
    run = _make_run(fixture)
    document = _make_document(fixture)
    session = fixture.factory()
    try:
        past = datetime.now(UTC) - timedelta(days=1)
        session.get(Run, run.id).updated_at = past
        session.get(Document, document.id).updated_at = past
        session.commit()
    finally:
        session.close()

    fixture.worker.recover_stranded_rows()

    claimed = {
        job.type
        for job in filter(None, (fixture.queue.claim(timeout_seconds=0) for _ in range(4)))
    }
    assert claimed == {JOB_EXECUTE_RUN, JOB_INGEST_DOCUMENT}


def test_an_unknown_job_type_is_acknowledged_rather_than_looping(fixture: Fixture) -> None:
    fixture.worker.handle(Job(id="j3", type="nonsense", payload={}))

    assert fixture.queue.claim(timeout_seconds=0) is None
