"""How the router treats a generation that fails rather than misbehaves.

The fallback exists so a chatty or malformed router response cannot cost a
reader their answer. A refused provider is a different thing: every specialist
the fallback would route to calls the same provider, so absorbing it would only
delay the same failure.
"""

import pytest

from app.agents.state import new_agent_state
from app.agents.supervisor import choose_route
from app.services.model_provider import ModelProviderError


def _state():
    return new_agent_state("What changed?")


def test_a_permanent_refusal_stops_the_run_instead_of_falling_back() -> None:
    def refuse(_prompt: str) -> str:
        raise ModelProviderError("credits are depleted", permanent=True, status_code=429)

    with pytest.raises(ModelProviderError):
        choose_route(_state(), generate=refuse, allowed={"retriever"}, max_steps=8)


def test_a_transient_failure_still_falls_back_to_a_deterministic_route() -> None:
    def stumble(_prompt: str) -> str:
        raise ModelProviderError("model overloaded", permanent=False, status_code=503)

    route = choose_route(_state(), generate=stumble, allowed={"retriever"}, max_steps=8)

    assert route in {"retriever", "finish"}


def test_a_malformed_router_response_still_falls_back() -> None:
    route = choose_route(
        _state(), generate=lambda _prompt: "I think retrieval?", allowed={"retriever"}, max_steps=8
    )

    assert route in {"retriever", "finish"}
