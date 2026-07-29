from collections.abc import Iterator
from contextlib import contextmanager

from app.services.generation import GeneratedText, TracedTextGenerator
from app.services.observability import NoopObservability


class _Generator:
    model = "test-model"

    def generate(self, prompt: str) -> str:
        return self.generate_with_usage(prompt).text

    def generate_with_usage(self, prompt: str) -> GeneratedText:
        return GeneratedText(text="answer", usage_details={"input": 3, "output": 2, "total": 5})


class _Generation:
    def __init__(self) -> None:
        self.completed: tuple[int, dict[str, int]] | None = None
        self.failed: Exception | None = None

    def complete(self, *, output_characters: int, usage_details: dict[str, int]) -> None:
        self.completed = (output_characters, usage_details)

    def fail(self, error: Exception) -> None:
        self.failed = error


class _Observability(NoopObservability):
    def __init__(self) -> None:
        self.model: str | None = None
        self.prompt_characters: int | None = None
        self.observation = _Generation()

    @contextmanager
    def generation(self, *, model: str, prompt_characters: int) -> Iterator[_Generation]:
        self.model = model
        self.prompt_characters = prompt_characters
        yield self.observation


def test_traced_generator_records_only_usage_and_character_counts() -> None:
    observability = _Observability()

    answer = TracedTextGenerator(_Generator(), observability).generate("secret question")

    assert answer == "answer"
    assert observability.model == "test-model"
    assert observability.prompt_characters == len("secret question")
    assert observability.observation.completed == (6, {"input": 3, "output": 2, "total": 5})
