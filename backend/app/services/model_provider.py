"""One place that decides whether a model-provider failure is worth retrying.

Both the text generator and the embedding provider raise `ModelProviderError`,
so the worker can answer a single question — retry, or stop? — without knowing
which provider was called or how it reports itself.

The distinction is not cosmetic. A rejected key, an unknown model, or an
exhausted account fails identically on every attempt: retrying spends the
queue's budget and the reader's time to arrive at the same answer three times.
A rate limit or a provider outage is the opposite, and must stay retryable.
"""

from __future__ import annotations

import httpx

# 429 is the ambiguous status: it covers both "slow down" and "this account is
# out of money". Only the latter is permanent, and the provider says which in
# the message body rather than in a code, so this matches on that text.
_BILLING_MARKERS = (
    "prepayment credits",
    "credits are depleted",
    "billing",
    "billing_not_active",
)

# Statuses that describe the request or the credentials rather than the moment
# they arrived: a different attempt with the same configuration is rejected the
# same way. 400 is included only when the provider names the key as the reason.
_PERMANENT_STATUSES = frozenset({401, 403, 404})


class ModelProviderError(RuntimeError):
    """A model call the provider refused.

    Deliberately a `RuntimeError`: the supervisor's router already falls back
    to a deterministic route when generation misbehaves, and a transient blip
    should keep being absorbed there. Only `permanent` failures bypass that
    fallback, because there the rest of the graph would fail the same way.

    The message is for the log. Reader-facing copy lives in `run_store`, so no
    provider text can reach the page through this.
    """

    def __init__(self, message: str, *, permanent: bool, status_code: int | None = None) -> None:
        super().__init__(message)
        self.permanent = permanent
        self.status_code = status_code


def classify(status_code: int | None, detail: str) -> bool:
    """Return True when `status_code` and `detail` describe a permanent refusal."""
    if status_code is None:
        # No status means the call never reached the provider — a DNS failure,
        # a dropped connection, a timeout. All transient by nature.
        return False
    if status_code in _PERMANENT_STATUSES:
        return True
    lowered = detail.lower()
    if status_code == 429:
        return any(marker in lowered for marker in _BILLING_MARKERS)
    if status_code == 400:
        # A malformed request would be a bug in this codebase, and retrying
        # would not fix that either — but only an invalid key is stated plainly
        # enough to be worth reporting as configuration.
        return "api_key_invalid" in lowered or "api key not valid" in lowered
    return False


def from_http_status(error: httpx.HTTPStatusError, *, context: str) -> ModelProviderError:
    """Build a classified error from an OpenAI-compatible gateway response."""
    status_code = error.response.status_code
    detail = _response_text(error.response)
    return ModelProviderError(
        f"{context} rejected with HTTP {status_code}: {detail[:500]}",
        permanent=classify(status_code, detail),
        status_code=status_code,
    )


def from_provider_exception(error: Exception, *, context: str) -> ModelProviderError:
    """Build a classified error from a google-genai exception.

    `google.genai.errors.APIError` carries `code` and `message`, but importing
    it here would pull the SDK into every caller, so this reads the attributes
    structurally instead.
    """
    status_code = getattr(error, "code", None)
    if not isinstance(status_code, int):
        status_code = getattr(getattr(error, "response", None), "status_code", None)
    if not isinstance(status_code, int):
        status_code = None
    detail = str(error)
    return ModelProviderError(
        f"{context} failed: {detail[:500]}",
        permanent=classify(status_code, detail),
        status_code=status_code,
    )


def _response_text(response: httpx.Response) -> str:
    try:
        return response.text
    except Exception:  # pragma: no cover - a body that cannot be read is not detail
        return ""
