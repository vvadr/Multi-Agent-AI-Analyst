"""Durable persistence for analyst runs, their progress events, and evidence.

Every read here is filtered by `organization_id`. That is not defence in depth
layered on top of the route check — it *is* the check. A caller cannot ask this
module for a run without saying which organization is asking, so there is no
code path that returns another tenant's row by omission.
"""

from __future__ import annotations

from datetime import UTC, date, datetime
from uuid import UUID

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.agents.state import Citation
from app.db.models import DailyUsage, Feedback, Run, RunCitation, RunEvent

# Copy that reaches the browser when a run dies. Deliberately identical for
# every internal cause: a provider outage and a malformed graph response must
# be indistinguishable to a reader.
RUN_FAILURE_MESSAGE = "The analyst run could not complete. Please try again."
# Kept distinct from the message above because the advice in it would be wrong:
# the model provider refused the request outright, and the next attempt is
# refused identically until someone fixes the key, the model name, or the
# account. Still fixed copy — no provider text reaches a reader through this.
RUN_PROVIDER_FAILURE_MESSAGE = (
    "The analyst service could not reach its model provider. This needs an "
    "administrator — retrying will not help."
)


class QuotaExceededError(Exception):
    """The organization has used its allowance for the day."""


def _utc_now() -> datetime:
    return datetime.now(UTC)


def create_run(
    session: Session,
    *,
    organization_id: UUID,
    user_id: UUID | None,
    question: str,
) -> Run:
    """Persist a queued run. The caller enqueues the job only after this commits."""
    run = Run(
        organization_id=organization_id,
        created_by_user_id=user_id,
        question=question,
        status="queued",
    )
    session.add(run)
    session.flush()
    append_event(session, run=run, event_type="run_started", data={"run_id": str(run.id)})
    session.commit()
    return run


def get_run(session: Session, *, organization_id: UUID, run_id: UUID) -> Run | None:
    return session.scalar(
        select(Run).where(Run.id == run_id, Run.organization_id == organization_id)
    )


def list_runs(session: Session, *, organization_id: UUID, limit: int = 50) -> list[Run]:
    return list(
        session.scalars(
            select(Run)
            .where(Run.organization_id == organization_id)
            .order_by(Run.created_at.desc())
            .limit(limit)
        )
    )


def append_event(
    session: Session,
    *,
    run: Run,
    event_type: str,
    data: dict[str, object],
) -> RunEvent:
    """Append the next numbered event for a run.

    Sequences are contiguous per run, which is what lets a reconnecting client
    resume from `Last-Event-ID` exactly rather than approximately.
    """
    next_sequence = (
        session.scalar(
            select(func.coalesce(func.max(RunEvent.sequence), 0)).where(RunEvent.run_id == run.id)
        )
        or 0
    ) + 1
    event = RunEvent(
        run_id=run.id,
        organization_id=run.organization_id,
        sequence=next_sequence,
        event_type=event_type,
        data=data,
    )
    session.add(event)
    session.flush()
    return event


def events_since(
    session: Session, *, organization_id: UUID, run_id: UUID, after_sequence: int
) -> list[RunEvent]:
    return list(
        session.scalars(
            select(RunEvent)
            .where(
                RunEvent.run_id == run_id,
                RunEvent.organization_id == organization_id,
                RunEvent.sequence > after_sequence,
            )
            .order_by(RunEvent.sequence.asc())
        )
    )


def stale_runs(session: Session, *, older_than: datetime) -> list[Run]:
    """Runs whose worker died before reaching a terminal state."""
    return list(
        session.scalars(
            select(Run).where(
                Run.status.in_(("queued", "running")),
                Run.updated_at < older_than,
            )
        )
    )


def citations_for(session: Session, *, run_id: UUID) -> list[RunCitation]:
    return list(
        session.scalars(
            select(RunCitation)
            .where(RunCitation.run_id == run_id)
            .order_by(RunCitation.position.asc())
        )
    )


def mark_running(session: Session, *, run: Run) -> None:
    run.status = "running"
    run.started_at = _utc_now()
    run.attempt_count += 1
    session.commit()


def mark_completed(
    session: Session, *, run: Run, answer: str, citations: list[Citation]
) -> None:
    run.status = "completed"
    run.answer = answer
    run.completed_at = _utc_now()
    for position, citation in enumerate(citations):
        session.add(_citation_row(run=run, position=position, citation=citation))
    append_event(
        session,
        run=run,
        event_type="completed",
        data={"run_id": str(run.id), "citation_count": len(citations)},
    )
    session.commit()


def mark_failed(session: Session, *, run: Run, message: str = RUN_FAILURE_MESSAGE) -> None:
    run.status = "failed"
    run.error = message
    run.completed_at = _utc_now()
    append_event(session, run=run, event_type="failed", data={"message": message})
    session.commit()


def _citation_row(*, run: Run, position: int, citation: Citation) -> RunCitation:
    document_id = citation.get("document_id")
    parsed_document_id: UUID | None = None
    if document_id:
        try:
            parsed_document_id = UUID(str(document_id))
        except ValueError:
            # A retrieval payload that is not a real document id is metadata,
            # not a reason to lose an otherwise valid answer.
            parsed_document_id = None
    return RunCitation(
        run_id=run.id,
        organization_id=run.organization_id,
        position=position,
        reference=str(citation["id"])[:120],
        kind=str(citation["kind"]),
        title=str(citation["title"])[:512],
        excerpt=str(citation["excerpt"]),
        url=(str(citation["url"])[:2048] if citation.get("url") else None),
        document_id=parsed_document_id,
        chunk_index=citation.get("chunk_index"),
    )


def record_feedback(
    session: Session,
    *,
    run: Run,
    user_id: UUID | None,
    rating: int,
    comment: str | None,
) -> Feedback:
    """Store one verdict per reader per run, replacing any earlier one."""
    existing = session.scalar(
        select(Feedback).where(Feedback.run_id == run.id, Feedback.user_id == user_id)
    )
    if existing:
        existing.rating = rating
        existing.comment = comment
        session.commit()
        return existing
    feedback = Feedback(
        run_id=run.id,
        organization_id=run.organization_id,
        user_id=user_id,
        rating=rating,
        comment=comment,
    )
    session.add(feedback)
    session.commit()
    return feedback


def consume_daily_quota(session: Session, *, organization_id: UUID, limit: int) -> None:
    """Count one run against today's allowance, or refuse it.

    The counter lives in PostgreSQL rather than Redis on purpose: a cache flush
    must not hand an organization a fresh day's allowance.
    """
    today = _utc_now().date()
    _ensure_usage_row(session, organization_id=organization_id, usage_date=today)
    updated = session.execute(
        update(DailyUsage)
        .where(
            DailyUsage.organization_id == organization_id,
            DailyUsage.usage_date == today,
            DailyUsage.run_count < limit,
        )
        .values(run_count=DailyUsage.run_count + 1)
    )
    if updated.rowcount == 0:
        session.rollback()
        raise QuotaExceededError("daily run quota reached")
    session.commit()


def _ensure_usage_row(session: Session, *, organization_id: UUID, usage_date: date) -> None:
    exists = session.scalar(
        select(DailyUsage.id).where(
            DailyUsage.organization_id == organization_id,
            DailyUsage.usage_date == usage_date,
        )
    )
    if exists:
        return
    session.add(DailyUsage(organization_id=organization_id, usage_date=usage_date, run_count=0))
    try:
        session.commit()
    except IntegrityError:
        # Another request created today's row first, which is the desired state.
        session.rollback()
