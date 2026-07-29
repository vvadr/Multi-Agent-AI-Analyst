"""Run specialist agents independently while the Phase 2 API is being built."""

import argparse

from app.agents.data import data_agent
from app.agents.retriever import retriever_agent
from app.agents.state import new_agent_state
from app.agents.web import web_agent
from app.core.config import get_settings
from app.ingestion.factory import build_document_ingestion_service
from app.services.generation import build_text_generator
from app.services.safe_sql import SafeSqlExecutor
from app.services.web_search import TavilyWebSearch


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Exercise one Phase 2 specialist agent.")
    subcommands = parser.add_subparsers(dest="agent", required=True)

    retrieve = subcommands.add_parser("retrieve")
    retrieve.add_argument("question")
    retrieve.add_argument("--tenant-id", required=True)

    web = subcommands.add_parser("web")
    web.add_argument("question")

    sql = subcommands.add_parser("sql")
    sql.add_argument("question")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    settings = get_settings()
    state = new_agent_state(args.question)

    if args.agent == "retrieve":
        ingestion = build_document_ingestion_service(settings)
        update = retriever_agent(state, tenant_id=args.tenant_id, search=ingestion.search)
    elif args.agent == "web":
        update = web_agent(state, search=TavilyWebSearch(settings).search)
    else:
        generator = build_text_generator(settings)
        executor = SafeSqlExecutor(settings)
        update = data_agent(state, generate_sql=generator.generate, execute_sql=executor.execute)

    for document in update.get("documents", []):
        print(document)
    if "sql_result" in update:
        print(update["sql_result"])
    print(f"Steps: {', '.join(update['steps'])}")


if __name__ == "__main__":
    main()
