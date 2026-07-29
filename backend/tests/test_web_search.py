from unittest.mock import MagicMock

import pytest

from app.core.config import Settings
from app.services.web_search import TavilyWebSearch, WebSearchResult, WebSearchUnavailable


def _settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "app_env": "test",
        "enable_web_search": True,
        "tavily_api_key": "tavily-key",
    }
    values.update(overrides)
    return Settings(**values)


def test_tavily_search_sends_a_bounded_request_and_filters_invalid_sources(monkeypatch) -> None:
    response = MagicMock()
    response.json.return_value = {
        "results": [
            {"title": "Good", "url": "https://example.com", "content": "Useful result"},
            {"title": "Bad", "url": "file:///private", "content": "Ignored"},
        ]
    }
    post = MagicMock(return_value=response)
    monkeypatch.setattr("app.services.web_search.httpx.post", post)

    results = TavilyWebSearch(_settings()).search(query=" market update ", limit=2)

    assert results == [
        WebSearchResult(title="Good", url="https://example.com", content="Useful result")
    ]
    assert post.call_args.kwargs["json"]["query"] == "market update"
    assert post.call_args.kwargs["json"]["max_results"] == 2


def test_tavily_search_is_not_available_when_disabled() -> None:
    with pytest.raises(WebSearchUnavailable):
        TavilyWebSearch(_settings(enable_web_search=False)).search(query="market")
