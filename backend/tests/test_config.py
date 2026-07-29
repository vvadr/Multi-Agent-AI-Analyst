from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings, _select_env_file


def _production_settings(**overrides) -> dict[str, object]:
    values: dict[str, object] = {
        "app_env": "production",
        "allowed_origins": "https://app.example.com",
        "jwt_secret_key": "jwt-secret",
        "database_url": "postgresql+psycopg://user:pass@db.example.com/app",
        "gemini_api_key": "gemini-secret",
        "qdrant_url": "https://qdrant.example.com",
        "qdrant_api_key": "qdrant-secret",
        "object_storage_endpoint": "https://storage.example.com",
        "object_storage_region": "us-east-1",
        "object_storage_access_key_id": "storage-key",
        "object_storage_secret_access_key": "storage-secret",
    }
    values.update(overrides)
    return values


def test_development_selects_only_development_file(monkeypatch) -> None:
    monkeypatch.delenv("ENV_FILE", raising=False)
    monkeypatch.setenv("APP_ENV", "development")

    selected = _select_env_file()

    assert selected is not None
    assert selected.name == ".env.development"


def test_production_selects_only_production_file(monkeypatch) -> None:
    monkeypatch.delenv("ENV_FILE", raising=False)
    monkeypatch.setenv("APP_ENV", "production")

    selected = _select_env_file()

    assert selected is not None
    assert selected.name == ".env.production"


def test_test_environment_loads_no_dotenv(monkeypatch) -> None:
    monkeypatch.delenv("ENV_FILE", raising=False)
    monkeypatch.setenv("APP_ENV", "test")

    assert _select_env_file() is None


def test_explicit_env_file_wins(monkeypatch, tmp_path: Path) -> None:
    explicit = tmp_path / "ci.env"
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("ENV_FILE", str(explicit))

    assert _select_env_file() == explicit


def test_development_rejects_remote_data_services() -> None:
    with pytest.raises(ValidationError, match="development cannot use remote"):
        Settings(
            app_env="development",
            database_url="postgresql+psycopg://user:pass@db.example.com/app",
        )


def test_production_rejects_localhost_cors() -> None:
    with pytest.raises(ValidationError, match="ALLOWED_ORIGINS"):
        Settings(**_production_settings(allowed_origins="http://localhost:3000"))


def test_production_requires_all_service_configuration() -> None:
    with pytest.raises(ValidationError, match="QDRANT_API_KEY"):
        Settings(**_production_settings(qdrant_api_key=None))


def test_production_rejects_the_unauthenticated_demo_api() -> None:
    with pytest.raises(ValidationError, match="unauthenticated demo"):
        Settings(**_production_settings(enable_unauthenticated_demo_api=True))


def test_secret_values_are_redacted_from_repr() -> None:
    settings = Settings(**_production_settings())

    rendered = repr(settings)

    assert "jwt-secret" not in rendered
    assert "gemini-secret" not in rendered
    assert "storage-secret" not in rendered
