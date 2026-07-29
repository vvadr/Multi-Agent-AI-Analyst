"""End-to-end coverage of the authenticated product surface.

These exercise the path a real reader takes — register, confirm, sign in,
upload, ask, stream, rate — plus the boundaries that matter most: no token, a
token from another organization, and an exhausted allowance.
"""

from __future__ import annotations

import re
from collections.abc import Generator
from dataclasses import dataclass
from typing import Any
from urllib.parse import unquote
from uuid import UUID

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import auth as auth_routes
from app.api.routes import documents as document_routes
from app.api.routes import runs as run_routes
from app.auth import dependencies as auth_dependencies
from app.core.config import Settings
from app.db.base import Base
from app.db.models import Feedback, Run
from app.db.session import get_session
from app.main import app
from app.services import document_store, run_store
from app.services.email import EmailMessage
from app.services.rate_limit import InMemoryRateLimiter

PASSWORD = "correct-horse-battery-staple"


class RecordingEmailSender:
    """Captures what would have been delivered so tests can read the links."""

    def __init__(self) -> None:
        self.messages: list[EmailMessage] = []

    def send(self, message: EmailMessage) -> None:
        self.messages.append(message)

    def latest_token(self) -> str:
        match = re.search(r"token=([^\s]+)", self.messages[-1].body)
        assert match, "no token link in the delivered message"
        return unquote(match.group(1))


class RecordingQueue:
    """Accepts jobs without running them, so tests control execution."""

    def __init__(self) -> None:
        self.jobs: list[tuple[str, dict[str, Any]]] = []

    def enqueue(self, job_type: str, payload: dict[str, Any]) -> str:
        self.jobs.append((job_type, payload))
        return "job-id"


class FakeObjectStorage:
    stored: dict[str, bytes] = {}

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def put_document(self, *, tenant_id, document_id, filename, content, content_type) -> str:
        key = f"{tenant_id}/{document_id}/{filename}"
        FakeObjectStorage.stored[key] = content
        return key

    def delete_document(self, key: str) -> None:
        FakeObjectStorage.stored.pop(key, None)


@dataclass
class Harness:
    client: TestClient
    factory: sessionmaker[Session]
    settings: Settings
    email: RecordingEmailSender
    queue: RecordingQueue


@pytest.fixture
def harness(monkeypatch: pytest.MonkeyPatch) -> Generator[Harness, None, None]:
    settings = Settings(
        app_env="test",
        jwt_secret_key="a-test-secret-key-that-is-longer-than-thirty-two-characters",
        daily_run_quota_per_organization=3,
        rate_limit_runs_per_hour=5,
        # Password reset is the one flow that still needs a delivery route, so
        # the harness configures one. The sender itself is substituted below.
        email_sender="smtp",
        smtp_host="smtp.example.test",
    )
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_session() -> Generator[Session, None, None]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    email = RecordingEmailSender()
    queue = RecordingQueue()
    limiter = InMemoryRateLimiter()

    for module in (auth_routes, document_routes, run_routes):
        monkeypatch.setattr(module, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: settings)
    monkeypatch.setattr(auth_routes, "get_email_sender", lambda: email)
    monkeypatch.setattr(auth_routes, "get_rate_limiter", lambda: limiter)
    monkeypatch.setattr(document_routes, "get_rate_limiter", lambda: limiter)
    monkeypatch.setattr(run_routes, "get_rate_limiter", lambda: limiter)
    monkeypatch.setattr(document_routes, "get_job_queue", lambda: queue)
    monkeypatch.setattr(run_routes, "get_job_queue", lambda: queue)
    # The SSE stream opens its own sessions rather than the request-scoped one.
    monkeypatch.setattr(run_routes, "_stream_session", factory)
    monkeypatch.setattr(document_routes, "ObjectStorage", FakeObjectStorage)
    # No test wants to reach a real Qdrant; vector cleanup is covered separately.
    monkeypatch.setattr(document_routes, "_delete_document_vectors", lambda *a, **k: None)
    FakeObjectStorage.stored.clear()

    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as client:
        yield Harness(client, factory, settings, email, queue)
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def register(harness: Harness, email: str = "reader@example.test") -> str:
    """Register and return the bearer token. Signing up signs you in."""
    created = harness.client.post(
        "/v1/auth/signup",
        json={"email": email, "password": PASSWORD, "display_name": "Reader"},
    )
    assert created.status_code == 201
    return str(created.json()["access_token"])


def auth_header(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


# --------------------------------------------------------------- access


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("post", "/v1/runs"),
        ("get", "/v1/runs"),
        ("get", "/v1/documents"),
        ("post", "/v1/documents"),
    ],
)
def test_product_endpoints_require_authentication(
    harness: Harness, method: str, path: str
) -> None:
    response = getattr(harness.client, method)(path)

    # 401, never the 404 the development-only demo used to answer with.
    assert response.status_code == 401


def test_signing_up_returns_a_usable_session_immediately(harness: Harness) -> None:
    """No confirmation step: the token from signup works on the next request."""
    created = harness.client.post(
        "/v1/auth/signup",
        json={"email": "new@example.test", "password": PASSWORD, "display_name": "New"},
    )

    assert created.status_code == 201
    token = created.json()["access_token"]
    assert harness.client.get("/v1/auth/me", headers=auth_header(token)).status_code == 200
    # Nothing was emailed, because nothing needed to be.
    assert harness.email.messages == []


def test_the_same_credentials_work_at_the_login_endpoint(harness: Harness) -> None:
    harness.client.post(
        "/v1/auth/signup",
        json={"email": "new@example.test", "password": PASSWORD, "display_name": "New"},
    )

    response = harness.client.post(
        "/v1/auth/login", json={"email": "new@example.test", "password": PASSWORD}
    )

    assert response.status_code == 200


def test_a_duplicate_address_is_refused_with_a_usable_reason(harness: Harness) -> None:
    payload = {"email": "dup@example.test", "password": PASSWORD, "display_name": "Dup"}
    first = harness.client.post("/v1/auth/signup", json=payload)

    second = harness.client.post("/v1/auth/signup", json=payload)

    assert first.status_code == 201
    # A signup form that silently did nothing would be unusable; the reader has
    # to be told why the address was refused.
    assert second.status_code == 409


def test_password_reset_is_refused_when_nothing_can_deliver_it(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Better to say so than to accept the request and send nothing."""
    monkeypatch.setattr(harness.settings, "email_sender", "console")

    response = harness.client.post(
        "/v1/auth/password-reset", json={"email": "reader@example.test"}
    )

    assert response.status_code == 503


def test_password_reset_revokes_existing_sessions(harness: Harness) -> None:
    token = register(harness)
    assert harness.client.get("/v1/auth/me", headers=auth_header(token)).status_code == 200

    harness.client.post("/v1/auth/password-reset", json={"email": "reader@example.test"})
    reset = harness.client.post(
        "/v1/auth/password-reset/confirm",
        json={"token": harness.email.latest_token(), "password": "an-entirely-new-passphrase"},
    )

    assert reset.status_code == 200
    # The refresh cookie from the old session must no longer buy a new token.
    assert harness.client.post("/v1/auth/refresh").status_code == 401


# ------------------------------------------------------------- documents


def test_upload_persists_a_row_and_queues_ingestion(harness: Harness) -> None:
    token = register(harness)

    response = harness.client.post(
        "/v1/documents",
        headers=auth_header(token),
        files={"file": ("notes.txt", b"quarterly revenue grew", "text/plain")},
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "pending"
    assert harness.queue.jobs == [("ingest_document", {"document_id": body["id"]})]
    # The bytes reached storage under a server-derived key.
    assert any(body["id"] in key for key in FakeObjectStorage.stored)


def test_upload_rejects_an_unsupported_format(harness: Harness) -> None:
    token = register(harness)

    response = harness.client.post(
        "/v1/documents",
        headers=auth_header(token),
        files={"file": ("payload.exe", b"MZ", "application/octet-stream")},
    )

    assert response.status_code == 415


def test_upload_enforces_the_configured_byte_limit(
    harness: Harness, monkeypatch: pytest.MonkeyPatch
) -> None:
    token = register(harness)
    monkeypatch.setattr(harness.settings, "max_upload_bytes", 8)

    response = harness.client.post(
        "/v1/documents",
        headers=auth_header(token),
        files={"file": ("big.txt", b"x" * 64, "text/plain")},
    )

    assert response.status_code == 413


def test_documents_are_scoped_to_the_owning_organization(harness: Harness) -> None:
    owner = register(harness, "owner@example.test")
    harness.client.post(
        "/v1/documents",
        headers=auth_header(owner),
        files={"file": ("private.txt", b"internal figures", "text/plain")},
    )
    intruder = register(harness, "intruder@example.test")

    listed = harness.client.get("/v1/documents", headers=auth_header(intruder))

    assert listed.status_code == 200
    assert listed.json()["documents"] == []


def test_fetching_another_organizations_document_is_not_found(harness: Harness) -> None:
    owner = register(harness, "owner2@example.test")
    created = harness.client.post(
        "/v1/documents",
        headers=auth_header(owner),
        files={"file": ("private.txt", b"internal figures", "text/plain")},
    ).json()
    intruder = register(harness, "intruder2@example.test")

    response = harness.client.get(
        f"/v1/documents/{created['id']}", headers=auth_header(intruder)
    )

    # 404 rather than 403: a distinct code would confirm the id exists.
    assert response.status_code == 404


# ------------------------------------------------------------------ runs


def test_creating_a_run_persists_it_and_queues_work(harness: Harness) -> None:
    token = register(harness)

    response = harness.client.post(
        "/v1/runs", headers=auth_header(token), json={"question": "How did revenue move?"}
    )

    assert response.status_code == 202
    body = response.json()
    assert body["status"] == "queued"
    assert ("execute_run", {"run_id": body["id"]}) in harness.queue.jobs


def test_a_run_survives_the_process_that_created_it(harness: Harness) -> None:
    """The answer is read from storage, not from the accepting process's memory."""
    token = register(harness)
    created = harness.client.post(
        "/v1/runs", headers=auth_header(token), json={"question": "What changed?"}
    ).json()

    # Stand in for the worker finishing the job in another process entirely.
    session = harness.factory()
    try:
        run = session.get(Run, UUID(created["id"]))
        run_store.mark_running(session, run=run)
        run_store.mark_completed(
            session,
            run=run,
            answer="Revenue grew nine percent.",
            citations=[
                {
                    "id": "doc-1",
                    "kind": "document",
                    "title": "Annual report",
                    "excerpt": "revenue grew",
                }
            ],
        )
    finally:
        session.close()

    fetched = harness.client.get(f"/v1/runs/{created['id']}", headers=auth_header(token))

    assert fetched.status_code == 200
    body = fetched.json()
    assert body["status"] == "completed"
    assert body["answer"] == "Revenue grew nine percent."
    assert body["citations"][0]["title"] == "Annual report"


def test_another_organization_cannot_read_a_run(harness: Harness) -> None:
    owner = register(harness, "owner3@example.test")
    created = harness.client.post(
        "/v1/runs", headers=auth_header(owner), json={"question": "Confidential?"}
    ).json()
    intruder = register(harness, "intruder3@example.test")

    response = harness.client.get(f"/v1/runs/{created['id']}", headers=auth_header(intruder))

    assert response.status_code == 404


def test_the_daily_quota_stops_further_runs(harness: Harness) -> None:
    token = register(harness)
    for _ in range(harness.settings.daily_run_quota_per_organization):
        accepted = harness.client.post(
            "/v1/runs", headers=auth_header(token), json={"question": "again"}
        )
        assert accepted.status_code == 202

    refused = harness.client.post(
        "/v1/runs", headers=auth_header(token), json={"question": "one too many"}
    )

    assert refused.status_code == 429


def test_the_event_stream_replays_from_last_event_id(harness: Harness) -> None:
    token = register(harness)
    created = harness.client.post(
        "/v1/runs", headers=auth_header(token), json={"question": "Stream this"}
    ).json()

    session = harness.factory()
    try:
        run = session.get(Run, UUID(created["id"]))
        run_store.append_event(session, run=run, event_type="retrieving", data={})
        session.commit()
        run_store.mark_failed(session, run=run)
    finally:
        session.close()

    with harness.client.stream(
        "GET",
        f"/v1/runs/{created['id']}/events",
        headers={**auth_header(token), "Last-Event-ID": "1"},
    ) as response:
        body = "".join(response.iter_text())

    assert response.status_code == 200
    # Sequence 1 was the run_started event the client already saw.
    assert "event: run_started" not in body
    assert "event: retrieving" in body
    assert "event: failed" in body
    assert "id: 2" in body


def test_feedback_is_recorded_once_per_reader(harness: Harness) -> None:
    token = register(harness)
    created = harness.client.post(
        "/v1/runs", headers=auth_header(token), json={"question": "Rate me"}
    ).json()

    first = harness.client.post(
        f"/v1/runs/{created['id']}/feedback",
        headers=auth_header(token),
        json={"rating": 1, "comment": "useful"},
    )
    second = harness.client.post(
        f"/v1/runs/{created['id']}/feedback",
        headers=auth_header(token),
        json={"rating": -1},
    )

    assert (first.status_code, second.status_code) == (204, 204)
    session = harness.factory()
    try:
        stored = session.query(Feedback).all()
    finally:
        session.close()
    assert len(stored) == 1
    assert stored[0].rating == -1


def test_document_deletion_removes_the_row_and_the_object(harness: Harness) -> None:
    token = register(harness)
    created = harness.client.post(
        "/v1/documents",
        headers=auth_header(token),
        files={"file": ("gone.txt", b"delete me", "text/plain")},
    ).json()

    response = harness.client.delete(
        f"/v1/documents/{created['id']}", headers=auth_header(token)
    )

    assert response.status_code == 204
    assert not FakeObjectStorage.stored
    listed = harness.client.get("/v1/documents", headers=auth_header(token)).json()
    assert listed["documents"] == []


def test_stale_rows_are_visible_for_recovery(harness: Harness) -> None:
    """The sweep the worker runs on startup can see abandoned work."""
    from datetime import UTC, datetime, timedelta

    token = register(harness)
    harness.client.post("/v1/runs", headers=auth_header(token), json={"question": "stranded"})
    harness.client.post(
        "/v1/documents",
        headers=auth_header(token),
        files={"file": ("stranded.txt", b"content", "text/plain")},
    )

    session = harness.factory()
    try:
        future = datetime.now(UTC) + timedelta(hours=1)
        assert run_store.stale_runs(session, older_than=future)
        assert document_store.stale_processing(session, older_than=future)
    finally:
        session.close()
