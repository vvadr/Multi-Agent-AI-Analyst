from pathlib import Path

import pytest
from pydantic import ValidationError

from app.core.config import Settings, _select_env_file


def _production_settings(**overrides) -> dict[str, object]:
    values: dict[str, object] = {
        "app_env": "production",
        "allowed_origins": "https://app.example.com",
        "jwt_secret_key": "jwt-secret-that-is-longer-than-thirty-two-characters",
        "database_url": "postgresql+psycopg://user:pass@db.example.com/app",
        "gemini_api_key": "gemini-secret",
        "qdrant_url": "https://qdrant.example.com",
        "qdrant_api_key": "qdrant-secret",
        "object_storage_endpoint": "https://storage.example.com",
        "object_storage_region": "us-east-1",
        "object_storage_access_key_id": "storage-key",
        "object_storage_secret_access_key": "storage-secret",
        "redis_url": "rediss://cache.example.com:6379",
        "public_app_url": "https://app.example.com",
        "email_sender": "smtp",
        "smtp_host": "smtp.example.com",
        "email_from_address": "no-reply@example.com",
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


def test_production_runs_without_a_separate_queue() -> None:
    # No Redis means the API executes work in an embedded worker. Runs are still
    # durable rows, so this is a scaling limit rather than a correctness one.
    settings = Settings(**_production_settings(redis_url=None))

    assert settings.redis_url is None
    assert settings.embedded_worker_enabled is True


def test_configuring_redis_hands_execution_to_a_worker_service() -> None:
    # With a queue present the API stops executing, because a separate worker
    # is the expected topology.
    settings = Settings(**_production_settings(redis_url="rediss://cache.example.com:6379"))

    assert settings.embedded_worker_enabled is False


def test_the_embedded_worker_can_be_forced_on_alongside_redis() -> None:
    # A single-service deployment that happens to have Redis: durable queue,
    # in-process execution. Without this the jobs would queue and never run.
    settings = Settings(
        **_production_settings(
            redis_url="rediss://cache.example.com:6379", run_embedded_worker=True
        )
    )

    assert settings.embedded_worker_enabled is True


def test_the_embedded_worker_can_be_forced_off_without_redis() -> None:
    settings = Settings(**_production_settings(redis_url=None, run_embedded_worker=False))

    assert settings.embedded_worker_enabled is False


def test_production_runs_without_any_email_provider() -> None:
    # Sign-up and sign-in never send email, so a deployment without a provider
    # is fully functional — it just has no self-service password reset.
    settings = Settings(**_production_settings(email_sender="console", smtp_host=None))

    assert settings.password_reset_available is False


def test_production_rejects_a_half_configured_email_sender() -> None:
    # Selecting SMTP without a host would accept reset requests and deliver
    # nothing, which is worse than not offering reset at all.
    with pytest.raises(ValidationError, match="SMTP_HOST"):
        Settings(**_production_settings(email_sender="smtp", smtp_host=None))


def test_production_rejects_a_localhost_app_url() -> None:
    with pytest.raises(ValidationError, match="PUBLIC_APP_URL"):
        Settings(**_production_settings(public_app_url="http://localhost:3000"))


def test_production_requires_a_deliverable_from_address() -> None:
    with pytest.raises(ValidationError, match="EMAIL_FROM_ADDRESS"):
        Settings(**_production_settings(email_from_address="no-reply@localhost"))


def test_production_requires_a_long_jwt_signing_key() -> None:
    with pytest.raises(ValidationError, match="JWT_SECRET_KEY"):
        Settings(**_production_settings(jwt_secret_key="too-short"))


def test_enabled_langfuse_tracing_requires_both_keys() -> None:
    with pytest.raises(ValidationError, match="LANGFUSE_PUBLIC_KEY"):
        Settings(app_env="test", enable_langfuse_tracing=True)


def test_secret_values_are_redacted_from_repr() -> None:
    settings = Settings(**_production_settings())

    rendered = repr(settings)

    assert "jwt-secret-that-is-longer-than-thirty-two-characters" not in rendered
    assert "gemini-secret" not in rendered
    assert "storage-secret" not in rendered
