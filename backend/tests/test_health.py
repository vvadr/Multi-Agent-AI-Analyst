from fastapi.testclient import TestClient

from app.api.routes import health
from app.main import app

client = TestClient(app)


def _ready_components(*, reachable: bool) -> dict[str, dict[str, bool]]:
    return {
        name: {"configured": True, "reachable": reachable}
        for name in ("database", "model", "qdrant", "object_storage")
    }


def test_healthcheck_is_available() -> None:
    response = client.get("/healthz")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert response.headers["X-Request-ID"]


def test_versioned_healthcheck_is_available() -> None:
    response = client.get("/v1/healthz")

    assert response.status_code == 200


def test_valid_request_id_is_echoed() -> None:
    response = client.get("/healthz", headers={"X-Request-ID": "test-request-123"})

    assert response.headers["X-Request-ID"] == "test-request-123"


def test_invalid_request_id_is_replaced() -> None:
    response = client.get("/healthz", headers={"X-Request-ID": "not valid!"})

    assert response.headers["X-Request-ID"] != "not valid!"


def test_readiness_returns_component_details(monkeypatch) -> None:
    monkeypatch.setattr(
        health,
        "check_readiness",
        lambda _settings: _ready_components(reachable=True),
    )

    response = client.get("/readyz")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ready",
        "components": _ready_components(reachable=True),
    }


def test_readiness_returns_503_when_a_dependency_fails(monkeypatch) -> None:
    components = _ready_components(reachable=True)
    components["database"]["reachable"] = False
    monkeypatch.setattr(health, "check_readiness", lambda _settings: components)

    response = client.get("/readyz")

    assert response.status_code == 503
    assert response.json()["status"] == "not_ready"
