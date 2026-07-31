"""The OpenAI-compatible embedding path.

The vector width is the thing worth pinning: Qdrant fixes a collection's size
at creation, so a provider that returns a different width fails every upsert
from then on — a misconfiguration that only shows up at write time.
"""

from unittest.mock import MagicMock

import httpx
import pytest

from app.core.config import Settings
from app.services.embeddings import (
    GatewayEmbeddingProvider,
    GeminiEmbeddingProvider,
    build_embedding_provider,
)
from app.services.model_provider import ModelProviderError


def _gateway_settings(**overrides) -> Settings:
    return Settings(
        app_env="test",
        litellm_base_url="https://api.openai.com",
        litellm_master_key="gateway-secret",
        litellm_embedding_model="text-embedding-3-small",
        **overrides,
    )


def test_the_configured_vector_width_is_sent_to_the_provider(monkeypatch) -> None:
    response = MagicMock()
    response.json.return_value = {"data": [{"index": 0, "embedding": [0.1, 0.2]}]}
    post = MagicMock(return_value=response)
    monkeypatch.setattr("app.services.embeddings.httpx.post", post)

    GatewayEmbeddingProvider(_gateway_settings(embedding_dimensions=1536)).embed(["hello"])

    assert post.call_args.kwargs["json"]["dimensions"] == 1536
    assert post.call_args.kwargs["json"]["model"] == "text-embedding-3-small"


def test_a_rejected_embedding_key_is_reported_as_permanent(monkeypatch) -> None:
    request = httpx.Request("POST", "https://api.openai.com/v1/embeddings")
    response = httpx.Response(401, text="invalid_api_key", request=request)
    monkeypatch.setattr("app.services.embeddings.httpx.post", lambda *a, **k: response)

    with pytest.raises(ModelProviderError) as raised:
        GatewayEmbeddingProvider(_gateway_settings()).embed(["hello"])

    # Indexing every queued upload three times cannot make the key valid.
    assert raised.value.permanent is True
    assert raised.value.status_code == 401


def test_the_factory_follows_the_same_path_as_generation() -> None:
    assert isinstance(build_embedding_provider(_gateway_settings()), GatewayEmbeddingProvider)
    assert isinstance(
        build_embedding_provider(Settings(app_env="test", gemini_api_key="gemini-key")),
        GeminiEmbeddingProvider,
    )
