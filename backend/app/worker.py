"""The background worker: the only process that executes queued work.

Runs as its own service in production. The web process accepts a request,
writes a durable row, enqueues a job, and returns — nothing user-facing ever
waits on a model provider.

Failure handling has one rule worth stating plainly: a row is only marked
`failed` once the queue has given up retrying it. Until then the row stays in
its in-progress state, because a transient provider outage on attempt one must
not present itself to the reader as a permanent failure.
"""

from __future__ import annotations

import signal
from datetime import UTC, datetime, timedelta
from uuid import UUID

import structlog
from sqlalchemy.orm import Session

from app.agents.workflow import WorkflowDependencies, run_workflow
from app.core.config import Settings, get_settings
from app.core.logging import configure_logging
from app.db.models import Document, Run
from app.db.session import create_session
from app.ingestion.extraction import DocumentExtractionError, extract_document_text
from app.ingestion.factory import build_document_ingestion_service
from app.services import document_store, run_store
from app.services.generation import build_text_generator
from app.services.memory import ConversationMemory
from app.services.object_storage import ObjectStorage
from app.services.observability import build_observability
from app.services.queue import (
    JOB_EXECUTE_RUN,
    JOB_INGEST_DOCUMENT,
    Job,
    JobQueue,
    build_job_queue,
)
from app.services.safe_sql import SafeSqlExecutor
from app.services.web_search import TavilyWebSearch

logger = structlog.get_logger(__name__)


class Worker:
    """Claims jobs and runs them to a terminal state."""

    def __init__(self, settings: Settings, queue: JobQueue) -> None:
        self.settings = settings
        self.queue = queue
        self._running = True

    def stop(self, *_: object) -> None:
        """Finish the job in hand, then exit. Called from the signal handler."""
        self._running = False

    def run_forever(self) -> None:
        logger.info("worker_started")
        self.recover_stranded_rows()
        while self._running:
            try:
                self.queue.recover_expired()
                job = self.queue.claim(timeout_seconds=self.settings.worker_poll_interval_seconds)
            except Exception:
                # A queue outage must not kill the worker; the next tick retries.
                logger.exception("job_claim_failed")
                continue
            if job is None:
                continue
            self.handle(job)
        logger.info("worker_stopped")

    def handle(self, job: Job) -> None:
        session = create_session()
        try:
            if job.type == JOB_EXECUTE_RUN:
                self._execute_run(session, job)
            elif job.type == JOB_INGEST_DOCUMENT:
                self._ingest_document(session, job)
            else:
                logger.warning("job_type_unknown", job_type=job.type)
            self.queue.ack(job)
        except Exception:
            session.rollback()
            logger.exception("job_failed", job_type=job.type, attempts=job.attempts)
            will_retry = self.queue.retry(job)
            if not will_retry:
                self._mark_permanently_failed(session, job)
        finally:
            session.close()

    # ---------------------------------------------------------------- runs

    def _execute_run(self, session: Session, job: Job) -> None:
        run = session.get(Run, _job_uuid(job, "run_id"))
        if run is None:
            logger.warning("run_missing", job_id=job.id)
            return
        if run.status in {"completed", "failed", "cancelled"}:
            return

        run_store.mark_running(session, run=run)
        tenant_id = str(run.organization_id)
        settings = self.settings
        observability = build_observability(settings)

        def emit(kind: str, data: dict[str, object]) -> None:
            # Persisted rather than pushed: the SSE endpoint reads these back by
            # sequence, so a reader who reconnects misses nothing.
            run_store.append_event(session, run=run, event_type=kind, data=data)
            session.commit()

        memory = ConversationMemory(settings)
        try:
            generator = build_text_generator(settings, observability=observability)
            ingestion = build_document_ingestion_service(settings)
            sql_executor = (
                SafeSqlExecutor(settings).execute if settings.enable_sql_agent else None
            )
            state = run_workflow(
                run.question,
                dependencies=WorkflowDependencies(
                    generate=generator.generate,
                    search_documents=ingestion.search,
                    search_web=TavilyWebSearch(settings).search,
                    execute_sql=sql_executor,
                    tenant_id=tenant_id,
                    max_steps=settings.max_agent_steps,
                    max_revisions=settings.max_agent_revisions,
                    web_enabled=settings.enable_web_search and bool(settings.tavily_api_key),
                    recall_memory=lambda question, limit: memory.recall(
                        question, limit, tenant_id=tenant_id
                    ),
                    observability=observability,
                    run_id=str(run.id),
                    max_tool_calls=settings.max_tool_calls,
                    deadline_seconds=float(settings.run_timeout_seconds),
                ),
                emit=emit,
            )
        finally:
            try:
                observability.flush()
            except Exception:
                # Telemetry must never turn a valid answer into a failed run.
                logger.warning("observability_flush_failed")

        run_store.mark_completed(
            session, run=run, answer=state["answer"], citations=state["citations"]
        )
        try:
            memory.remember(
                tenant_id=tenant_id, question=run.question, answer=state["answer"]
            )
        except Exception:
            # Recall improves follow-ups; losing it does not invalidate this answer.
            logger.warning("memory_write_failed", run_id=str(run.id))

    # ----------------------------------------------------------- documents

    def _ingest_document(self, session: Session, job: Job) -> None:
        document = session.get(Document, _job_uuid(job, "document_id"))
        if document is None:
            logger.warning("document_missing", job_id=job.id)
            return
        if document.status in {"ready", "deleted"}:
            return

        document_store.mark_processing(session, document=document)
        settings = self.settings
        raw = ObjectStorage(settings).get_document(document.object_key)
        try:
            content = extract_document_text(
                filename=document.filename,
                content=raw,
                max_characters=settings.max_extracted_characters,
                max_archive_members=settings.max_archive_members,
                max_expansion_ratio=settings.max_archive_expansion_ratio,
            )
        except DocumentExtractionError:
            # A file this parser cannot read will never become readable, so this
            # is terminal immediately rather than after three identical retries.
            document_store.mark_failed(
                session, document=document, reason=document_store.FAILURE_EXTRACTION
            )
            logger.info("document_extraction_rejected", document_id=str(document.id))
            return

        chunks = build_document_ingestion_service(settings).ingest_text(
            tenant_id=str(document.organization_id),
            document_id=str(document.id),
            filename=document.filename,
            content=content,
        )
        document_store.mark_ready(session, document=document, chunk_count=chunks)
        logger.info("document_ready", document_id=str(document.id), chunks=chunks)

    # ------------------------------------------------------------ recovery

    def _mark_permanently_failed(self, session: Session, job: Job) -> None:
        """Give the reader a terminal answer once retries are exhausted."""
        try:
            if job.type == JOB_EXECUTE_RUN:
                run = session.get(Run, _job_uuid(job, "run_id"))
                if run and run.status not in {"completed", "failed", "cancelled"}:
                    run_store.mark_failed(session, run=run)
            elif job.type == JOB_INGEST_DOCUMENT:
                document = session.get(Document, _job_uuid(job, "document_id"))
                if document and document.status not in {"ready", "deleted"}:
                    document_store.mark_failed(
                        session, document=document, reason=document_store.FAILURE_INDEXING
                    )
        except Exception:
            logger.exception("terminal_state_write_failed", job_type=job.type)

    def recover_stranded_rows(self) -> None:
        """Re-enqueue work whose process died before Redis knew about it.

        This is what makes the queue disposable. Redis can be flushed or
        replaced entirely and no user's upload or question is lost, because the
        rows in PostgreSQL are the record of what still needs doing.
        """
        cutoff = datetime.now(UTC) - timedelta(
            seconds=self.settings.job_visibility_timeout_seconds
        )
        session = create_session()
        try:
            requeued = 0
            for document in document_store.stale_processing(session, older_than=cutoff):
                self.queue.enqueue(JOB_INGEST_DOCUMENT, {"document_id": str(document.id)})
                requeued += 1
            for run in run_store.stale_runs(session, older_than=cutoff):
                self.queue.enqueue(JOB_EXECUTE_RUN, {"run_id": str(run.id)})
                requeued += 1
            if requeued:
                logger.info("stranded_work_requeued", count=requeued)
        except Exception:
            logger.exception("stranded_recovery_failed")
        finally:
            session.close()


def _job_uuid(job: Job, key: str) -> UUID:
    return UUID(str(job.payload[key]))


def main() -> None:
    settings = get_settings()
    configure_logging(settings.log_level, json_logs=settings.app_env == "production")
    worker = Worker(settings, build_job_queue(settings))
    # Render sends SIGTERM on deploy and shutdown; draining beats dropping.
    signal.signal(signal.SIGTERM, worker.stop)
    signal.signal(signal.SIGINT, worker.stop)
    worker.run_forever()


if __name__ == "__main__":
    main()
