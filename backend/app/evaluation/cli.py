"""Run the Phase 4 evaluation dataset against configured local services."""

import json
from argparse import ArgumentParser

from app.agents.workflow import WorkflowDependencies, run_workflow
from app.core.config import get_settings
from app.evaluation.harness import (
    EvaluationCase,
    evaluate_cases,
    evaluate_with_ragas,
    format_report,
)
from app.ingestion.factory import build_document_ingestion_service
from app.services.generation import build_text_generator
from app.services.safe_sql import SafeSqlExecutor
from app.services.web_search import TavilyWebSearch


def _judge(generate, case: EvaluationCase, state) -> int:
    prompt = (
        "Score this answer from 1 to 5 for correctness and grounding. Return only an integer.\n"
        f"Question: {case.question}\nAnswer: {state['answer']}\nCitations: {state['citations']}"
    )
    raw = generate(prompt).strip()
    score = int(raw[:1])
    return score if 1 <= score <= 5 else 1


def main() -> None:
    parser = ArgumentParser(description="Run the Phase 4 evaluation dataset.")
    parser.add_argument("--ragas", action="store_true", help="Also run optional RAGAS metrics.")
    args = parser.parse_args()
    settings = get_settings()
    generator = build_text_generator(settings)
    ingestion = build_document_ingestion_service(settings)
    sql_executor = SafeSqlExecutor(settings).execute if settings.enable_sql_agent else None

    def run(question: str):
        return run_workflow(
            question,
            dependencies=WorkflowDependencies(
                generate=generator.generate,
                search_documents=ingestion.search,
                search_web=TavilyWebSearch(settings).search,
                execute_sql=sql_executor,
                tenant_id=settings.demo_tenant_id,
                max_steps=settings.max_agent_steps,
                max_revisions=settings.max_agent_revisions,
                web_enabled=settings.enable_web_search and bool(settings.tavily_api_key),
            ),
        )

    results = evaluate_cases(run, judge=lambda case, state: _judge(generator.generate, case, state))
    print(format_report(results))
    print(json.dumps([result.__dict__ for result in results], indent=2))
    if args.ragas:
        ragas_rows = [
            {
                "question": result.question,
                "answer": result.answer,
                "contexts": result.contexts,
            }
            for result in results
        ]
        print(evaluate_with_ragas(ragas_rows))


if __name__ == "__main__":
    main()
