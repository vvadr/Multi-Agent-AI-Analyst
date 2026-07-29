"""Small text-generation adapters used by specialist agents."""

from dataclasses import dataclass
from typing import Protocol

import httpx

from app.core.config import Settings
from app.services.observability import WorkflowObservability


@dataclass(frozen=True)
class GeneratedText:
    text: str
    usage_details: dict[str, int]


class TextGenerator(Protocol):
    model: str

    def generate(self, prompt: str) -> str: ...

    def generate_with_usage(self, prompt: str) -> GeneratedText: ...


class GeminiTextGenerator:
    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for agent generation")
        self.api_key = settings.gemini_api_key.get_secret_value()
        self.model = settings.gemini_model

    def generate(self, prompt: str) -> str:
        return self.generate_with_usage(prompt).text

    def generate_with_usage(self, prompt: str) -> GeneratedText:
        from google import genai
        from google.genai import types

        client = genai.Client(api_key=self.api_key)
        response = client.models.generate_content(
            model=self.model,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=0),
        )
        if not response.text:
            raise RuntimeError("model returned an empty response")
        usage = getattr(response, "usage_metadata", None)
        return GeneratedText(
            text=response.text,
            usage_details=_usage_from_object(usage),
        )


class GatewayTextGenerator:
    def __init__(self, settings: Settings) -> None:
        if not settings.litellm_base_url or not settings.litellm_master_key:
            raise ValueError("LITELLM_BASE_URL and LITELLM_MASTER_KEY are required")
        self.url = f"{settings.litellm_base_url.rstrip('/')}/v1/chat/completions"
        self.api_key = settings.litellm_master_key.get_secret_value()
        self.model = settings.litellm_model
        self.timeout = settings.run_timeout_seconds

    def generate(self, prompt: str) -> str:
        return self.generate_with_usage(prompt).text

    def generate_with_usage(self, prompt: str) -> GeneratedText:
        try:
            response = httpx.post(
                self.url,
                headers={"Authorization": f"Bearer {self.api_key}"},
                json={
                    "model": self.model,
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            body = response.json()
            content = body["choices"][0]["message"]["content"]
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError) as exc:
            raise RuntimeError("model generation request failed") from exc
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError("model returned an empty response")
        usage = body.get("usage") if isinstance(body, dict) else None
        return GeneratedText(text=content, usage_details=_usage_from_object(usage))


class TracedTextGenerator:
    """Record provider-reported token use without exporting prompt or answer text."""

    def __init__(self, delegate: TextGenerator, observability: WorkflowObservability) -> None:
        self._delegate = delegate
        self._observability = observability
        self.model = delegate.model

    def generate(self, prompt: str) -> str:
        with self._observability.generation(
            model=self.model, prompt_characters=len(prompt)
        ) as observation:
            try:
                generated = self._delegate.generate_with_usage(prompt)
            except Exception as error:
                observation.fail(error)
                raise
            observation.complete(
                output_characters=len(generated.text), usage_details=generated.usage_details
            )
            return generated.text

    def generate_with_usage(self, prompt: str) -> GeneratedText:
        # The workflow consumes plain strings. This method keeps the wrapper
        # compatible with the underlying provider protocol for future callers.
        return GeneratedText(text=self.generate(prompt), usage_details={})


def build_text_generator(
    settings: Settings, *, observability: WorkflowObservability | None = None
) -> TextGenerator:
    if settings.use_model_gateway:
        generator: TextGenerator = GatewayTextGenerator(settings)
    else:
        generator = GeminiTextGenerator(settings)
    return TracedTextGenerator(generator, observability) if observability else generator


def _usage_from_object(usage: object) -> dict[str, int]:
    """Normalize direct-Gemini and OpenAI-compatible usage field names."""
    if isinstance(usage, dict):
        source = usage
        get_value = source.get
    else:
        def get_value(name: str, default: object = None) -> object:
            return getattr(usage, name, default)

    def integer(*names: str) -> int | None:
        for name in names:
            value = get_value(name)
            if isinstance(value, int) and value >= 0:
                return value
        return None

    input_tokens = integer("prompt_token_count", "prompt_tokens", "input_tokens")
    output_tokens = integer("candidates_token_count", "completion_tokens", "output_tokens")
    total_tokens = integer("total_token_count", "total_tokens")
    details = {
        key: value
        for key, value in {
            "input": input_tokens,
            "output": output_tokens,
            "total": total_tokens,
        }.items()
        if value is not None
    }
    if "total" not in details and "input" in details and "output" in details:
        details["total"] = details["input"] + details["output"]
    return details
