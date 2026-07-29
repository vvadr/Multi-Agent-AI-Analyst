"""Development-only analyst-run and server-sent event endpoints."""

from functools import lru_cache
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from app.agents.state import Citation
from app.api.routes.documents import _demo_settings
from app.core.config import get_settings
from app.services.demo_runs import DemoRun, DemoRunStore

router = APIRouter()


class CreateRunRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)


class RunAccepted(BaseModel):
    id: str
    status: str


class RunResult(BaseModel):
    id: str
    status: str
    answer: str | None = None
    citations: list[Citation] = []
    error: str | None = None


@lru_cache
def get_demo_run_store() -> DemoRunStore:
    return DemoRunStore(get_settings())


@router.post("/runs", status_code=status.HTTP_202_ACCEPTED, response_model=RunAccepted)
def create_run(payload: CreateRunRequest) -> RunAccepted:
    _demo_settings()
    try:
        run = get_demo_run_store().submit(payload.question.strip())
    except RuntimeError as exc:
        raise HTTPException(
            status_code=429, detail="The local demo is busy; try again shortly"
        ) from exc
    return RunAccepted(id=str(run.id), status=run.status)


@router.get("/runs/{run_id}", response_model=RunResult)
def get_run(run_id: UUID) -> RunResult:
    _demo_settings()
    run = _require_run(run_id)
    return _serialize_run(run)


@router.get("/runs/{run_id}/events")
def stream_run_events(run_id: UUID) -> StreamingResponse:
    _demo_settings()
    _require_run(run_id)
    return StreamingResponse(
        get_demo_run_store().event_stream(run_id),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


def _require_run(run_id: UUID) -> DemoRun:
    run = get_demo_run_store().get(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


def _serialize_run(run: DemoRun) -> RunResult:
    return RunResult(
        id=str(run.id),
        status=run.status,
        answer=run.state["answer"] if run.state else None,
        citations=run.state["citations"] if run.state else [],
        error=run.error,
    )
