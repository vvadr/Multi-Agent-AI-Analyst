"""Embedding-provider adapters kept behind the ingestion service protocol."""

import httpx

from app.core.config import Settings


class GeminiEmbeddingProvider:
    """Gemini embedding adapter with a configured, stable vector dimension."""

    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for document ingestion")
        self.api_key = settings.gemini_api_key.get_secret_value()
        self.model = settings.gemini_embedding_model
        self.dimensions = settings.embedding_dimensions

    def embed(self, texts: list[str]) -> list[list[float]]:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        response = client.models.embed_content(
            model=self.model,
            contents=texts,
            config=types.EmbedContentConfig(output_dimensionality=self.dimensions),
        )
        return [list(embedding.values) for embedding in response.embeddings]


class GatewayEmbeddingProvider:
    """OpenAI-compatible embedding adapter for the optional local LiteLLM gateway."""

    def __init__(self, settings: Settings) -> None:
        if not settings.litellm_base_url or not settings.litellm_master_key:
            raise ValueError("LITELLM_BASE_URL and LITELLM_MASTER_KEY are required")
        self.url = f"{settings.litellm_base_url.rstrip('/')}/v1/embeddings"
        self.api_key = settings.litellm_master_key.get_secret_value()
        self.model = settings.litellm_embedding_model
        # Embedding a document is an agent operation, not a quick readiness
        # probe. It shares the bounded run timeout rather than the short probe
        # timeout so an otherwise healthy provider is not rejected prematurely.
        self.timeout = settings.run_timeout_seconds

    def embed(self, texts: list[str]) -> list[list[float]]:
        response = httpx.post(
            self.url,
            headers={"Authorization": f"Bearer {self.api_key}"},
            json={"model": self.model, "input": texts},
            timeout=self.timeout,
        )
        response.raise_for_status()
        body = response.json()
        data = body.get("data") if isinstance(body, dict) else None
        if not isinstance(data, list):
            raise RuntimeError("embedding gateway returned an invalid response")
        try:
            ordered = sorted(data, key=lambda item: item["index"])
            return [list(item["embedding"]) for item in ordered]
        except (KeyError, TypeError):
            raise RuntimeError("embedding gateway returned an invalid response") from None


def build_embedding_provider(
    settings: Settings,
) -> GeminiEmbeddingProvider | GatewayEmbeddingProvider:
    """Select the same direct-vs-gateway model path used by readiness checks."""
    if settings.use_model_gateway:
        return GatewayEmbeddingProvider(settings)
    return GeminiEmbeddingProvider(settings)
