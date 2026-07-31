from unittest.mock import MagicMock

import boto3
import pytest

from app.core.config import Settings
from app.services import readiness


@pytest.fixture(autouse=True)
def _clear_model_probe_cache():
    """The probe cache is process-wide; a leaked verdict would hide a regression."""
    readiness._model_probe_cache.clear()
    yield
    readiness._model_probe_cache.clear()


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
        redis_url="rediss://cache.example.com:6379",
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

    external = {name: value for name, value in result.items() if name != "queue"}
    assert all(not component["configured"] for component in external.values())
    assert all(not component["reachable"] for component in external.values())


def test_the_in_process_queue_reports_ready_without_redis() -> None:
    # Without REDIS_URL the API runs an embedded worker. There is a queue; it
    # just has no socket, so it can never be unreachable.
    result = readiness.check_readiness(Settings(app_env="test"))

    assert result["queue"] == {"configured": True, "reachable": True}


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


def test_model_probe_generates_rather_than_reading_metadata(monkeypatch) -> None:
    # Metadata endpoints answer 200 for an account that cannot generate a
    # single token, so readiness has to spend one to mean anything.
    response = MagicMock()
    post = MagicMock(return_value=response)
    monkeypatch.setattr(readiness.httpx, "post", post)

    readiness._call_model(_configured_settings())

    assert post.call_args.args[0].endswith(":generateContent")
    assert post.call_args.kwargs["json"]["generationConfig"]["maxOutputTokens"] == 1
    response.raise_for_status.assert_called_once()


def test_model_probe_exercises_the_gateway_upstream_not_its_liveness(monkeypatch) -> None:
    response = MagicMock()
    post = MagicMock(return_value=response)
    monkeypatch.setattr(readiness.httpx, "post", post)
    settings = Settings(
        app_env="test",
        litellm_base_url="http://litellm:4000",
        litellm_master_key="gateway-secret",
    )

    readiness._call_model(settings)

    # /health/liveliness proves the proxy is up, not that its Google key works.
    assert post.call_args.args[0] == "http://litellm:4000/v1/chat/completions"
    assert post.call_args.kwargs["json"]["max_tokens"] == 1
    response.raise_for_status.assert_called_once()


def test_model_probe_allows_more_time_than_a_socket_check(monkeypatch) -> None:
    post = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(readiness.httpx, "post", post)

    readiness._call_model(_configured_settings())

    assert post.call_args.kwargs["timeout"].connect >= 10.0


def test_a_refused_model_is_not_ready(monkeypatch) -> None:
    def refuse(_settings: Settings) -> None:
        raise RuntimeError("429 RESOURCE_EXHAUSTED: prepayment credits are depleted")

    monkeypatch.setattr(readiness, "_call_model", refuse)

    result = readiness.check_readiness(_configured_settings())

    assert result["model"] == {"configured": True, "reachable": False}


def test_repeated_readiness_checks_do_not_bill_per_request(monkeypatch) -> None:
    # `/readyz` needs no credentials, so an uncached probe would let anyone
    # spend the account's tokens by holding down refresh.
    calls = []
    monkeypatch.setattr(readiness, "_call_model", lambda _settings: calls.append(1))
    settings = _configured_settings()

    readiness._probe_model(settings)
    readiness._probe_model(settings)
    readiness._probe_model(settings)

    assert len(calls) == 1


def test_a_cached_failure_is_replayed_rather_than_forgotten(monkeypatch) -> None:
    calls = []

    def refuse(_settings: Settings) -> None:
        calls.append(1)
        raise RuntimeError("provider refused")

    monkeypatch.setattr(readiness, "_call_model", refuse)
    settings = _configured_settings()

    for _ in range(3):
        with pytest.raises(RuntimeError):
            readiness._probe_model(settings)

    assert len(calls) == 1
