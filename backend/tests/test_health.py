from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_healthcheck_is_available() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


def test_versioned_healthcheck_is_available() -> None:
    response = client.get("/v1/healthz")

    assert response.status_code == 200
