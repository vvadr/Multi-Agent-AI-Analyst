"""Small text-generation adapters used by specialist agents."""

import httpx

from app.core.config import Settings


class GeminiTextGenerator:
    def __init__(self, settings: Settings) -> None:
        if not settings.gemini_api_key:
            raise ValueError("GEMINI_API_KEY is required for agent generation")
        self.api_key = settings.gemini_api_key.get_secret_value()
        self.model = settings.gemini_model

    def generate(self, prompt: str) -> str:
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
        return response.text


class GatewayTextGenerator:
    def __init__(self, settings: Settings) -> None:
        if not settings.litellm_base_url or not settings.litellm_master_key:
            raise ValueError("LITELLM_BASE_URL and LITELLM_MASTER_KEY are required")
        self.url = f"{settings.litellm_base_url.rstrip('/')}/v1/chat/completions"
        self.api_key = settings.litellm_master_key.get_secret_value()
        self.model = settings.litellm_model
        self.timeout = settings.run_timeout_seconds

    def generate(self, prompt: str) -> str:
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
        return content


def build_text_generator(settings: Settings) -> GeminiTextGenerator | GatewayTextGenerator:
    if settings.use_model_gateway:
        return GatewayTextGenerator(settings)
    return GeminiTextGenerator(settings)
