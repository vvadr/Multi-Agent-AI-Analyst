"""Optional, privacy-safe Langfuse tracing for analyst workflows.

Tracing deliberately records workflow structure, model metadata, and token use
without sending questions, document text, prompts, answers, SQL, or credentials
to the tracing provider.  Enable it only after accepting the provider's data
handling terms for the deployment.
"""

from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass
from typing import Protocol

from app.core.config import Settings


class GenerationObservation(Protocol):
    def complete(self, *, output_characters: int, usage_details: dict[str, int]) -> None: ...

    def fail(self, error: Exception) -> None: ...


class WorkflowObservability(Protocol):
    @contextmanager
    def workflow(
        self, *, tenant_id: str, question_characters: int, run_id: str | None
    ) -> Iterator[None]: ...

    @contextmanager
    def span(self, name: str, *, kind: str = "span") -> Iterator[None]: ...

    @contextmanager
    def generation(
        self, *, model: str, prompt_characters: int
    ) -> Iterator[GenerationObservation]: ...

    def flush(self) -> None: ...


@dataclass(frozen=True)
class _NoopGeneration:
    def complete(self, *, output_characters: int, usage_details: dict[str, int]) -> None:
        return None

    def fail(self, error: Exception) -> None:
        return None


class NoopObservability:
    """No-op implementation so tracing never changes normal run behavior."""

    @contextmanager
    def workflow(
        self, *, tenant_id: str, question_characters: int, run_id: str | None
    ) -> Iterator[None]:
        yield

    @contextmanager
    def span(self, name: str, *, kind: str = "span") -> Iterator[None]:
        yield

    @contextmanager
    def generation(self, *, model: str, prompt_characters: int) -> Iterator[GenerationObservation]:
        yield _NoopGeneration()

    def flush(self) -> None:
        return None


class _LangfuseGeneration:
    def __init__(self, observation: object) -> None:
        self._observation = observation

    def complete(self, *, output_characters: int, usage_details: dict[str, int]) -> None:
        self._observation.update(
            output={"characters": output_characters},
            usage_details=usage_details,
        )

    def fail(self, error: Exception) -> None:
        self._observation.update(level="ERROR", status_message=type(error).__name__)


class LangfuseObservability:
    """Thin adapter around the current Langfuse Python SDK.

    Keep this SDK-specific code isolated: it makes the optional integration easy
    to upgrade and ensures the rest of the agent graph does not know about the
    tracing vendor.
    """

    def __init__(self, settings: Settings) -> None:
        from langfuse import Langfuse

        self._client = Langfuse(
            public_key=settings.langfuse_public_key.get_secret_value(),
            secret_key=settings.langfuse_secret_key.get_secret_value(),
            base_url=settings.langfuse_base_url,
            environment=settings.app_env,
        )

    @contextmanager
    def workflow(
        self, *, tenant_id: str, question_characters: int, run_id: str | None
    ) -> Iterator[None]:
        metadata = {
            "tenant_id": tenant_id,
            "question_characters": question_characters,
            "run_id": run_id,
        }
        with self._client.start_as_current_observation(
            name="analyst-workflow",
            as_type="agent",
            metadata=metadata,
        ) as observation:
            try:
                yield
                observation.update(output={"status": "completed"})
            except Exception as error:
                observation.update(level="ERROR", status_message=type(error).__name__)
                raise

    @contextmanager
    def span(self, name: str, *, kind: str = "span") -> Iterator[None]:
        with self._client.start_as_current_observation(name=name, as_type=kind):
            yield

    @contextmanager
    def generation(self, *, model: str, prompt_characters: int) -> Iterator[GenerationObservation]:
        with self._client.start_as_current_observation(
            name="model.generate",
            as_type="generation",
            model=model,
            input={"characters": prompt_characters},
            model_parameters={"temperature": 0},
        ) as observation:
            yield _LangfuseGeneration(observation)

    def flush(self) -> None:
        self._client.flush()


def build_observability(settings: Settings) -> WorkflowObservability:
    """Create tracing only when it was explicitly enabled and configured."""
    if not settings.enable_langfuse_tracing:
        return NoopObservability()
    return LangfuseObservability(settings)
