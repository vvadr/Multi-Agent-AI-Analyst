from unittest.mock import MagicMock

from app.core.config import Settings
from app.services.generation import GatewayTextGenerator, build_text_generator


def test_gateway_generation_extracts_message_content(monkeypatch) -> None:
    response = MagicMock()
    response.json.return_value = {"choices": [{"message": {"content": "SELECT 1"}}]}
    post = MagicMock(return_value=response)
    monkeypatch.setattr("app.services.generation.httpx.post", post)
    settings = Settings(
        app_env="test",
        litellm_base_url="http://litellm:4000",
        litellm_master_key="gateway-secret",
    )

    result = GatewayTextGenerator(settings).generate("SQL only")

    assert result == "SELECT 1"
    assert post.call_args.kwargs["json"]["temperature"] == 0


def test_factory_selects_gateway_when_configured() -> None:
    settings = Settings(
        app_env="test",
        litellm_base_url="http://litellm:4000",
        litellm_master_key="gateway-secret",
    )

    assert isinstance(build_text_generator(settings), GatewayTextGenerator)
