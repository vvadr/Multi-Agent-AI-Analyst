"""Guarded Tavily search adapter for untrusted web content."""

from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from app.core.config import Settings

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
MAX_QUERY_LENGTH = 500
MAX_RESULT_CONTENT_LENGTH = 4_000


@dataclass(frozen=True)
class WebSearchResult:
    title: str
    url: str
    content: str


class WebSearchUnavailable(RuntimeError):
    """Raised when web search is deliberately disabled or not configured."""


class TavilyWebSearch:
    """Small Tavily client that never exposes provider response details."""

    def __init__(self, settings: Settings) -> None:
        self.enabled = settings.enable_web_search
        self.api_key = (
            settings.tavily_api_key.get_secret_value() if settings.tavily_api_key else None
        )
        self.timeout = settings.service_probe_timeout_seconds

    def search(self, *, query: str, limit: int = 4) -> list[WebSearchResult]:
        if not self.enabled or not self.api_key:
            raise WebSearchUnavailable("web search is not available")
        normalized_query = " ".join(query.split())
        if not normalized_query:
            raise ValueError("query must not be empty")
        if len(normalized_query) > MAX_QUERY_LENGTH:
            raise ValueError("query is too long")
        if not 1 <= limit <= 10:
            raise ValueError("limit must be between one and ten")

        try:
            response = httpx.post(
                TAVILY_SEARCH_URL,
                json={
                    "api_key": self.api_key,
                    "query": normalized_query,
                    "max_results": limit,
                    "search_depth": "basic",
                    "include_answer": False,
                },
                timeout=self.timeout,
            )
            response.raise_for_status()
            body = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise WebSearchUnavailable("web search request failed") from exc

        raw_results = body.get("results") if isinstance(body, dict) else None
        if not isinstance(raw_results, list):
            raise WebSearchUnavailable("web search returned an invalid response")
        return [result for item in raw_results if (result := self._parse_result(item))]

    @staticmethod
    def _parse_result(raw: object) -> WebSearchResult | None:
        if not isinstance(raw, dict):
            return None
        title = raw.get("title")
        url = raw.get("url")
        content = raw.get("content")
        if not all(isinstance(value, str) for value in (title, url, content)):
            return None
        if urlparse(url).scheme not in {"http", "https"}:
            return None
        return WebSearchResult(
            title=" ".join(title.split())[:500] or "Untitled source",
            url=url,
            content=" ".join(content.split())[:MAX_RESULT_CONTENT_LENGTH],
        )
