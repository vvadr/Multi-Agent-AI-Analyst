"""Repeatable local evaluation of Phase 4 retrieval, routing, and grounding."""

import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from app.agents.state import AgentState

DATASET_PATH = Path(__file__).with_name("dataset.json")
Runner = Callable[[str], AgentState]


@dataclass(frozen=True)
class EvaluationCase:
    id: str
    question: str
    expected_terms: list[str]
    kind: str


@dataclass(frozen=True)
class EvaluationResult:
    case_id: str
    question: str
    kind: str
    answer: str
    contexts: list[str]
    answer_term_recall: float
    citation_coverage: float
    judge_score: int | None


def load_dataset(path: Path = DATASET_PATH) -> list[EvaluationCase]:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(raw, list) or len(raw) < 10:
        raise ValueError("evaluation dataset must contain at least ten cases")
    cases: list[EvaluationCase] = []
    for item in raw:
        if not isinstance(item, dict):
            raise ValueError("evaluation dataset contains an invalid case")
        try:
            case = EvaluationCase(
                id=str(item["id"]),
                question=str(item["question"]),
                expected_terms=[str(term) for term in item["expected_terms"]],
                kind=str(item["kind"]),
            )
        except KeyError as exc:
            raise ValueError("evaluation dataset contains an invalid case") from exc
        if not case.id or not case.question:
            raise ValueError("evaluation dataset contains an invalid case")
        cases.append(case)
    return cases


def evaluate_cases(
    runner: Runner,
    *,
    judge: Callable[[EvaluationCase, AgentState], int] | None = None,
    cases: list[EvaluationCase] | None = None,
) -> list[EvaluationResult]:
    """Run deterministic metrics plus an optional isolated LLM-judge score."""
    results: list[EvaluationResult] = []
    for case in cases or load_dataset():
        state = runner(case.question)
        answer = state["answer"].lower()
        expected = [term.lower() for term in case.expected_terms]
        recall = 1.0 if not expected else sum(term in answer for term in expected) / len(expected)
        coverage = 1.0 if state["citations"] else 0.0
        judge_score = judge(case, state) if judge else None
        results.append(
            EvaluationResult(
                case_id=case.id,
                question=case.question,
                kind=case.kind,
                answer=state["answer"],
                contexts=[*state["memory"], *state["documents"]],
                answer_term_recall=recall,
                citation_coverage=coverage,
                judge_score=judge_score,
            )
        )
    return results


def format_report(results: list[EvaluationResult]) -> str:
    if not results:
        return "No evaluation cases ran."
    recall = sum(item.answer_term_recall for item in results) / len(results)
    coverage = sum(item.citation_coverage for item in results) / len(results)
    judged = [item.judge_score for item in results if item.judge_score is not None]
    judge = f"{sum(judged) / len(judged):.2f}/5" if judged else "not run"
    return (
        f"Cases: {len(results)}\n"
        f"Answer-term recall: {recall:.2%}\n"
        f"Citation coverage: {coverage:.2%}\n"
        f"LLM judge: {judge}"
    )


def evaluate_with_ragas(
    records: list[dict[str, object]],
) -> object:
    """Run optional RAGAS faithfulness/relevance/context metrics.

    RAGAS is intentionally an optional extra because its evaluator-provider
    dependencies are unsuitable for the lightweight local API process.
    """
    try:
        from datasets import Dataset
        from ragas import evaluate
        from ragas.metrics import answer_relevancy, context_precision, faithfulness
    except ImportError as exc:
        raise RuntimeError('Install the evaluation extra: pip install -e ".[eval]"') from exc
    dataset = Dataset.from_list(records)
    return evaluate(
        dataset,
        metrics=[faithfulness, answer_relevancy, context_precision],
    )
