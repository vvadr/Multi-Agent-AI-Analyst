"""Process-local run coordination for the development-only demo API."""

import json
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from time import monotonic
from typing import Literal
from uuid import UUID, uuid4

from app.agents.state import AgentState
from app.agents.workflow import WorkflowDependencies, run_workflow
from app.core.config import Settings
from app.ingestion.factory import build_document_ingestion_service
from app.services.generation import build_text_generator
from app.services.memory import ConversationMemory
from app.services.safe_sql import SafeSqlExecutor
from app.services.web_search import TavilyWebSearch

RunStatus = Literal["queued", "running", "completed", "failed"]


@dataclass(frozen=True)
class DemoEvent:
    type: str
    data: dict[str, object]


@dataclass
class DemoRun:
    id: UUID
    question: str
    status: RunStatus = "queued"
    events: list[DemoEvent] = field(default_factory=list)
    state: AgentState | None = None
    error: str | None = None
    created_at: float = field(default_factory=monotonic)


class DemoRunStore:
    """In-memory, single-process store. It is intentionally not production state."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._runs: dict[UUID, DemoRun] = {}
        self._lock = threading.Condition()
        self._executor = ThreadPoolExecutor(max_workers=settings.demo_max_concurrent_runs)

    def submit(self, question: str) -> DemoRun:
        with self._lock:
            active = sum(run.status in {"queued", "running"} for run in self._runs.values())
            if active >= self.settings.demo_max_concurrent_runs:
                raise RuntimeError("the local demo is busy; try again shortly")
            run = DemoRun(id=uuid4(), question=question)
            run.events.append(DemoEvent("run_started", {"run_id": str(run.id)}))
            self._runs[run.id] = run
            self._executor.submit(self._execute, run.id)
            return run

    def get(self, run_id: UUID) -> DemoRun | None:
        with self._lock:
            return self._runs.get(run_id)

    def event_stream(self, run_id: UUID):
        index = 0
        while True:
            with self._lock:
                run = self._runs.get(run_id)
                if not run:
                    return
                while index >= len(run.events) and run.status in {"queued", "running"}:
                    self._lock.wait(timeout=1)
                events = run.events[index:]
                index = len(run.events)
                terminal = run.status in {"completed", "failed"}
            for event in events:
                yield _sse(event)
            if terminal:
                return

    def _execute(self, run_id: UUID) -> None:
        with self._lock:
            run = self._runs[run_id]
            run.status = "running"
            self._lock.notify_all()

        def emit(kind: str, data: dict[str, object]) -> None:
            with self._lock:
                run.events.append(DemoEvent(kind, data))
                self._lock.notify_all()

        try:
            settings = self.settings
            ingestion = build_document_ingestion_service(settings)
            memory = ConversationMemory(settings)
            sql_executor = SafeSqlExecutor(settings).execute if settings.enable_sql_agent else None
            state = run_workflow(
                run.question,
                dependencies=WorkflowDependencies(
                    generate=build_text_generator(settings).generate,
                    search_documents=ingestion.search,
                    search_web=TavilyWebSearch(settings).search,
                    execute_sql=sql_executor,
                    tenant_id=settings.demo_tenant_id,
                    max_steps=settings.max_agent_steps,
                    max_revisions=settings.max_agent_revisions,
                    web_enabled=settings.enable_web_search and bool(settings.tavily_api_key),
                    recall_memory=memory.recall,
                ),
                emit=emit,
            )
        except Exception:  # Provider and graph details must not reach browser clients.
            with self._lock:
                run.status = "failed"
                run.error = "The analyst run could not complete. Please try again."
                run.events.append(DemoEvent("failed", {"message": run.error}))
                self._lock.notify_all()
            return

        with self._lock:
            run.status = "completed"
            run.state = state
            run.events.append(
                DemoEvent(
                    "completed",
                    {"run_id": str(run.id), "citation_count": len(state["citations"])},
                )
            )
            self._lock.notify_all()
        try:
            memory.remember(
                tenant_id=self.settings.demo_tenant_id,
                question=run.question,
                answer=state["answer"],
            )
        except Exception:
            # Persisted memory is best-effort in the local demo; the completed
            # answer remains valid when a provider or vector service is busy.
            pass


def _sse(event: DemoEvent) -> str:
    return f"event: {event.type}\ndata: {json.dumps(event.data, ensure_ascii=False)}\n\n"
