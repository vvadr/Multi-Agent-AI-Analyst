"""What counts as worth retrying.

The line matters in both directions: a permanent refusal retried three times
wastes the queue and delays the reader's answer, and a transient one treated as
permanent turns a passing blip into a failed run.
"""

import httpx
import pytest

from app.services import model_provider


@pytest.mark.parametrize(
    "status_code, detail",
    [
        (429, "RESOURCE_EXHAUSTED. Your prepayment credits are depleted."),
        (401, "unauthorized"),
        (403, "permission denied on this project"),
        (404, "models/gemini-does-not-exist is not found"),
        (400, "API key not valid. Please pass a valid API key."),
    ],
)
def test_configuration_and_billing_refusals_are_permanent(status_code, detail) -> None:
    assert model_provider.classify(status_code, detail) is True


@pytest.mark.parametrize(
    "status_code, detail",
    [
        # A plain rate limit is the same request arriving at a better moment.
        (429, "Quota exceeded: too many requests per minute. Retry later."),
        (500, "internal error"),
        (503, "the model is overloaded"),
        (400, "contents[0].parts: field is required"),
        (None, "connection reset by peer"),
    ],
)
def test_outages_and_rate_limits_stay_retryable(status_code, detail) -> None:
    assert model_provider.classify(status_code, detail) is False


def test_a_gateway_status_error_carries_its_upstream_verdict() -> None:
    response = httpx.Response(
        429,
        text="Your prepayment credits are depleted.",
        request=httpx.Request("POST", "http://litellm:4000/v1/chat/completions"),
    )
    source = httpx.HTTPStatusError("429", request=response.request, response=response)

    error = model_provider.from_http_status(source, context="gateway generation")

    assert error.permanent is True
    assert error.status_code == 429


def test_a_provider_exception_reads_its_status_code() -> None:
    class FakeApiError(Exception):
        code = 503

    error = model_provider.from_provider_exception(
        FakeApiError("the model is overloaded"), context="gemini generation"
    )

    assert error.permanent is False
    assert error.status_code == 503


def test_an_unrecognisable_failure_is_treated_as_transient() -> None:
    error = model_provider.from_provider_exception(
        Exception("socket closed"), context="gemini generation"
    )

    # Nothing here says the configuration is wrong, and guessing that it is
    # would fail a run that a second attempt would have answered.
    assert error.permanent is False
    assert error.status_code is None
