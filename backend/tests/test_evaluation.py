from app.agents.state import new_agent_state
from app.evaluation.harness import evaluate_cases, format_report, load_dataset


def test_dataset_has_at_least_ten_cases() -> None:
    assert len(load_dataset()) >= 10


def test_harness_reports_term_recall_and_citation_coverage() -> None:
    cases = load_dataset()[:1]

    def runner(_question: str):
        state = new_agent_state("question")
        state["answer"] = "Sustainability is the priority."
        state["citations"] = [
            {
                "id": "document:1:0",
                "kind": "document",
                "title": "report.txt",
                "excerpt": "Sustainability",
            }
        ]
        return state

    result = evaluate_cases(runner, cases=cases)

    assert result[0].answer_term_recall == 1
    assert result[0].citation_coverage == 1
    assert "Cases: 1" in format_report(result)
