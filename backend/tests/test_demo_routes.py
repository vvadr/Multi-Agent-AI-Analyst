from uuid import uuid4

from fastapi.testclient import TestClient

from app.api.routes import documents, runs
from app.core.config import Settings
from app.main import app
from app.services.demo_runs import DemoRun

client = TestClient(app)


def _demo_settings() -> Settings:
    return Settings(
        app_env="development",
        enable_unauthenticated_demo_api=True,
        database_url="postgresql+psycopg://analyst:analyst@localhost:5432/analyst",
    )


def test_document_endpoint_rejects_non_text_uploads(monkeypatch) -> None:
    monkeypatch.setattr(documents, "get_settings", _demo_settings)

    response = client.post(
        "/v1/documents",
        files={"file": ("report.pdf", b"not a PDF", "application/pdf")},
    )

    assert response.status_code == 415
    assert response.json()["detail"] == "Only UTF-8 .txt files are supported"


def test_run_endpoint_uses_the_local_demo_store(monkeypatch) -> None:
    demo_run = DemoRun(id=uuid4(), question="What changed?")

    class Store:
        def submit(self, question: str) -> DemoRun:
            assert question == "What changed?"
            return demo_run

    monkeypatch.setattr(documents, "get_settings", _demo_settings)
    monkeypatch.setattr(runs, "get_demo_run_store", lambda: Store())

    response = client.post("/v1/runs", json={"question": "  What changed?  "})

    assert response.status_code == 202
    assert response.json() == {"id": str(demo_run.id), "status": "queued"}
