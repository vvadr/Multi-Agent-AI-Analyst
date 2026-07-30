from __future__ import annotations

import pytest
from fastapi import HTTPException, Request
from fastapi.testclient import TestClient

from app.api.routes.auth import _require_same_origin_for_cookie_auth
from app.core.config import Settings
from app.main import create_app


def _production_settings() -> Settings:
    return Settings(
        app_env="production",
        allowed_origins="https://app.example.com",
        allowed_hosts="api.example.com",
        jwt_secret_key="jwt-secret-that-is-longer-than-thirty-two-characters",
        database_url="postgresql+psycopg://user:pass@db.example.com/app",
        gemini_api_key="gemini-secret",
        qdrant_url="https://qdrant.example.com",
        qdrant_api_key="qdrant-secret",
        object_storage_endpoint="https://storage.example.com",
        object_storage_region="us-east-1",
        object_storage_access_key_id="storage-key",
        object_storage_secret_access_key="storage-secret",
        public_app_url="https://app.example.com",
        run_embedded_worker=False,
    )


def _request(origin: str | None) -> Request:
    headers = [] if origin is None else [(b"origin", origin.encode("ascii"))]
    return Request(
        {"type": "http", "method": "POST", "path": "/v1/auth/refresh", "headers": headers}
    )


def test_cookie_authenticated_requests_require_the_configured_origin_in_production() -> None:
    settings = _production_settings()

    _require_same_origin_for_cookie_auth(_request("https://app.example.com"), settings)
    with pytest.raises(HTTPException) as caught:
        _require_same_origin_for_cookie_auth(_request("https://attacker.example"), settings)

    assert caught.value.status_code == 403


def test_production_api_adds_security_headers_and_rejects_unknown_hosts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = _production_settings()
    monkeypatch.setattr("app.main.get_settings", lambda: settings)
    app = create_app()

    with TestClient(app, base_url="https://api.example.com") as client:
        healthy = client.get("/healthz")
        rejected = client.get("/healthz", headers={"Host": "attacker.example"})

    assert healthy.status_code == 200
    assert healthy.headers["X-Content-Type-Options"] == "nosniff"
    assert healthy.headers["X-Frame-Options"] == "DENY"
    assert healthy.headers["Strict-Transport-Security"].startswith("max-age=")
    assert "default-src 'none'" in healthy.headers["Content-Security-Policy"]
    assert rejected.status_code == 400
