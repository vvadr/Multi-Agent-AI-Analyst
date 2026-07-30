"""Authenticated analyst runs and their progress stream.

Runs are durable. Creating one writes a row and queues a job; the answer is
produced by the worker and read back from PostgreSQL. Nothing about a run
depends on the web process that accepted it still being alive, which is what
lets a reader close the tab, come back, and still find their answer.

The event stream is replayed from stored rows rather than pushed from memory.
That makes `Last-Event-ID` exact, and means any web instance can serve the
stream for a run any worker is executing.
"""

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Request, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.agents.state import Citation
from app.api.deps import get_job_queue, get_rate_limiter
from app.auth.dependencies import get_current_principal
from app.auth.service import Principal
from app.core.config import get_settings
from app.db.models import RUN_TERMINAL_STATUSES
from app.db.session import create_session, get_session
from app.services import run_store
from app.services.queue import JOB_EXECUTE_RUN
from app.services.rate_limit import enforce, rate_limit_key
from app.services.run_store import QuotaExceededError

router = APIRouter()

DbSession = Annotated[Session, Depends(get_session)]
CurrentPrincipal = Annotated[Principal, Depends(get_current_principal)]

_ONE_HOUR = 60 * 60
# How often the stream looks for new events. Runs take seconds to minutes, so
# this is imperceptible to a reader and costs one indexed lookup per tick.
_STREAM_POLL_SECONDS = 0.5
# Bounds a stream against a worker that never reaches a terminal state.
_STREAM_MAX_SECONDS = 1800


class CreateRunRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)


class RunAccepted(BaseModel):
    id: str
    status: str


class RunResult(BaseModel):
    id: str
    status: str
    question: str
    answer: str | None = None
    citations: list[Citation] = []
    error: str | None = None


class RunListResponse(BaseModel):
    runs: list[RunAccepted]


class FeedbackRequest(BaseModel):
    rating: Literal[-1, 1]
    comment: str | None = Field(default=None, max_length=2_000)


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED, response_model=RunAccepted)
def create_run(
    payload: CreateRunRequest,
    request: Request,
    principal: CurrentPrincipal,
    session: DbSession,
) -> RunAccepted:
    settings = get_settings()
    enforce(
        get_rate_limiter(),
        settings=settings,
        key=rate_limit_key("runs", "organization", str(principal.organization_id)),
        limit=settings.rate_limit_runs_per_hour,
        window_seconds=_ONE_HOUR,
        unavailable="reject",
    )
    try:
        run_store.consume_daily_quota(
            session,
            organization_id=principal.organization_id,
            limit=settings.daily_run_quota_per_organization,
        )
    except QuotaExceededError as exc:
        raise HTTPException(
            status_code=429,
            detail="Your workspace has reached its daily analysis limit.",
        ) from exc

    run = run_store.create_run(
        session,
        organization_id=principal.organization_id,
        user_id=principal.user_id,
        question=payload.question.strip(),
    )
    try:
        get_job_queue().enqueue(JOB_EXECUTE_RUN, {"run_id": str(run.id)})
    except Exception as exc:
        # The run stays `queued` and the worker's sweep will claim it, so this
        # is a delay rather than a loss.
        raise HTTPException(
            status_code=503, detail="The analyst service is temporarily unavailable"
        ) from exc
    return RunAccepted(id=str(run.id), status=run.status)


@router.get("/runs", response_model=RunListResponse)
def list_runs(principal: CurrentPrincipal, session: DbSession) -> RunListResponse:
    runs = run_store.list_runs(session, organization_id=principal.organization_id)
    return RunListResponse(
        runs=[RunAccepted(id=str(run.id), status=run.status) for run in runs]
    )


@router.get("/runs/{run_id}", response_model=RunResult)
def get_run(run_id: UUID, principal: CurrentPrincipal, session: DbSession) -> RunResult:
    run = _require_run(session, principal, run_id)
    citations = run_store.citations_for(session, run_id=run.id)
    return RunResult(
        id=str(run.id),
        status=run.status,
        question=run.question,
        answer=run.answer,
        citations=[_citation(row) for row in citations],
        error=run.error,
    )


@router.post("/runs/{run_id}/feedback", status_code=status.HTTP_204_NO_CONTENT)
def submit_feedback(
    run_id: UUID,
    payload: FeedbackRequest,
    principal: CurrentPrincipal,
    session: DbSession,
) -> None:
    run = _require_run(session, principal, run_id)
    run_store.record_feedback(
        session,
        run=run,
        user_id=principal.user_id,
        rating=payload.rating,
        comment=payload.comment,
    )


@router.get("/runs/{run_id}/events")
def stream_run_events(
    run_id: UUID,
    principal: CurrentPrincipal,
    session: DbSession,
    last_event_id: Annotated[str | None, Header(alias="Last-Event-ID")] = None,
) -> StreamingResponse:
    """Replay stored events from `Last-Event-ID`, then follow the run live."""
    run = _require_run(session, principal, run_id)
    return StreamingResponse(
        _event_stream(
            organization_id=principal.organization_id,
            run_id=run.id,
            after_sequence=_parse_cursor(last_event_id),
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _stream_session() -> Session:
    """Open a session for the stream to use for one polling tick.

    Deliberately not the request-scoped dependency: a stream can outlive any
    single transaction, and holding one open for the length of a run would pin
    a pooled connection for minutes. Kept as its own function so tests can
    substitute a factory.
    """
    return create_session()


async def _event_stream(
    *, organization_id: UUID, run_id: UUID, after_sequence: int
) -> AsyncIterator[str]:
    """Yield SSE frames until the run reaches a terminal state."""
    cursor = after_sequence
    elapsed = 0.0
    while elapsed < _STREAM_MAX_SECONDS:
        session = _stream_session()
        try:
            events = run_store.events_since(
                session,
                organization_id=organization_id,
                run_id=run_id,
                after_sequence=cursor,
            )
            for event in events:
                cursor = event.sequence
                yield _sse(event.sequence, event.event_type, event.data)
            run = run_store.get_run(
                session, organization_id=organization_id, run_id=run_id
            )
            finished = run is None or run.status in RUN_TERMINAL_STATUSES
        finally:
            session.close()

        if finished and not events:
            return
        await asyncio.sleep(_STREAM_POLL_SECONDS)
        elapsed += _STREAM_POLL_SECONDS


def _sse(sequence: int, event_type: str, data: dict[str, object]) -> str:
    payload = json.dumps(data, ensure_ascii=False)
    return f"id: {sequence}\nevent: {event_type}\ndata: {payload}\n\n"


def _parse_cursor(last_event_id: str | None) -> int:
    """A malformed resume header replays from the start rather than failing."""
    if not last_event_id:
        return 0
    try:
        return max(0, int(last_event_id))
    except ValueError:
        return 0


def _require_run(session: Session, principal: Principal, run_id: UUID):
    run = run_store.get_run(
        session, organization_id=principal.organization_id, run_id=run_id
    )
    if not run:
        # A run belonging to another organization is reported as missing rather
        # than forbidden, so ids cannot be probed for existence.
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _citation(row) -> Citation:
    citation: Citation = {
        "id": row.reference,
        "kind": row.kind,
        "title": row.title,
        "excerpt": row.excerpt,
    }
    if row.url:
        citation["url"] = row.url
    if row.document_id:
        citation["document_id"] = str(row.document_id)
    if row.chunk_index is not None:
        citation["chunk_index"] = row.chunk_index
    return citation
