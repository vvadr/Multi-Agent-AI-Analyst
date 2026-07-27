import os
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIRECTORY = Path(__file__).resolve().parents[2]


def _select_env_file() -> Path:
    """Choose which .env file to load based on the run mode.

    Priority:
    1. An explicit ``ENV_FILE`` path (handy for Docker/CI).
    2. ``.env.<APP_ENV>`` — e.g. ``.env.development`` (local services) or
       ``.env.production`` (connected services).
    3. Plain ``.env`` as a fallback.

    ``APP_ENV`` is read from the process environment set by the launch command,
    so it selects the mode. On managed hosts (Render) variables are injected
    directly into the environment; a missing file is fine — pydantic then reads
    process env vars only.
    """
    explicit = os.getenv("ENV_FILE")
    if explicit:
        return Path(explicit)
    app_env = os.getenv("APP_ENV", "development")
    candidate = BACKEND_DIRECTORY / f".env.{app_env}"
    if candidate.exists():
        return candidate
    return BACKEND_DIRECTORY / ".env"


class Settings(BaseSettings):
    """Server configuration loaded from process env vars or a mode-specific
    ``backend/.env.<APP_ENV>`` file (see :func:`_select_env_file`)."""

    model_config = SettingsConfigDict(
        env_file=_select_env_file(),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Multi-Agent AI Analyst API"
    app_env: str = "development"
    api_v1_prefix: str = "/v1"
    log_level: str = "INFO"
    allowed_origins: str = "http://localhost:3000"

    jwt_secret_key: SecretStr | None = None
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    database_url: SecretStr | None = None

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-2.5-flash"
    gemini_embedding_model: str = "gemini-embedding-001"

    qdrant_url: str | None = None
    qdrant_api_key: SecretStr | None = None
    qdrant_collection: str = "analyst_documents"
    qdrant_prefer_grpc: bool = False

    object_storage_bucket: str = "analyst-documents"
    object_storage_endpoint: str | None = None
    object_storage_region: str = "auto"
    object_storage_access_key_id: SecretStr | None = None
    object_storage_secret_access_key: SecretStr | None = None

    tavily_api_key: SecretStr | None = None
    langfuse_public_key: SecretStr | None = None
    langfuse_secret_key: SecretStr | None = None
    langfuse_base_url: str = "https://cloud.langfuse.com"

    max_agent_steps: int = 8
    max_tool_calls: int = 5
    run_timeout_seconds: int = 60
    max_result_rows: int = 100
    sql_statement_timeout_ms: int = 5000
    enable_web_search: bool = False
    enable_code_execution: bool = False
    redis_url: SecretStr | None = None

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
