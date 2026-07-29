from unittest.mock import MagicMock

import boto3

from app.core.config import Settings
from app.services import readiness


def _configured_settings() -> Settings:
    return Settings(
        app_env="test",
        database_url="postgresql+psycopg://user:pass@db.example.com/app",
        gemini_api_key="gemini-key",
        qdrant_url="https://qdrant.example.com",
        qdrant_api_key="qdrant-key",
        object_storage_endpoint="https://storage.example.com",
        object_storage_region="us-east-1",
        object_storage_access_key_id="storage-key",
        object_storage_secret_access_key="storage-secret",
    )


def test_all_configured_probes_can_be_ready(monkeypatch) -> None:
    monkeypatch.setattr(
        readiness,
        "_PROBES",
        {name: lambda _settings: None for name in readiness._PROBES},
    )

    result = readiness.check_readiness(_configured_settings())

    assert all(component["configured"] for component in result.values())
    assert all(component["reachable"] for component in result.values())


def test_probe_failure_is_redacted_and_not_ready(monkeypatch) -> None:
    def fail(_settings: Settings) -> None:
        raise RuntimeError("sensitive provider response")

    probes = {name: lambda _settings: None for name in readiness._PROBES}
    probes["database"] = fail
    monkeypatch.setattr(readiness, "_PROBES", probes)

    result = readiness.check_readiness(_configured_settings())

    assert result["database"] == {"configured": True, "reachable": False}


def test_unconfigured_services_are_not_probed() -> None:
    result = readiness.check_readiness(Settings(app_env="test"))

    assert all(not component["configured"] for component in result.values())
    assert all(not component["reachable"] for component in result.values())


def test_database_probe_executes_select_one(monkeypatch) -> None:
    engine = MagicMock()
    connection = engine.connect.return_value.__enter__.return_value
    monkeypatch.setattr(readiness, "create_engine", lambda *args, **kwargs: engine)

    readiness._probe_database(_configured_settings())

    connection.execute.assert_called_once()
    engine.dispose.assert_called_once()


def test_qdrant_probe_lists_collections(monkeypatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(
        readiness,
        "QdrantClient",
        lambda *args, **kwargs: client,
    )

    readiness._probe_qdrant(_configured_settings())

    client.get_collections.assert_called_once()
    client.close.assert_called_once()


def test_object_storage_probe_heads_private_bucket(monkeypatch) -> None:
    client = MagicMock()
    monkeypatch.setattr(boto3, "client", lambda *args, **kwargs: client)

    readiness._probe_object_storage(_configured_settings())

    client.head_bucket.assert_called_once_with(Bucket="analyst-documents")


def test_model_probe_uses_gemini_metadata_endpoint(monkeypatch) -> None:
    response = MagicMock()
    monkeypatch.setattr(readiness.httpx, "get", lambda *args, **kwargs: response)

    readiness._probe_model(_configured_settings())

    response.raise_for_status.assert_called_once()


def test_model_probe_uses_gateway_when_configured(monkeypatch) -> None:
    response = MagicMock()
    get = MagicMock(return_value=response)
    monkeypatch.setattr(readiness.httpx, "get", get)
    settings = Settings(
        app_env="test",
        litellm_base_url="http://litellm:4000",
        litellm_master_key="gateway-secret",
    )

    readiness._probe_model(settings)

    assert get.call_args.args[0] == "http://litellm:4000/health/liveliness"
    response.raise_for_status.assert_called_once()
