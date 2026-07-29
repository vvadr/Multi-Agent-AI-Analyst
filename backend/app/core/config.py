import os
from functools import lru_cache
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

BACKEND_DIRECTORY = Path(__file__).resolve().parents[2]
EnvironmentName = Literal["development", "test", "production"]

_LOCAL_HOSTS = {
    "localhost",
    "127.0.0.1",
    "::1",
    "host.docker.internal",
    "postgres",
    "qdrant",
    "minio",
    "redis",
    "litellm",
}


def _select_env_file() -> Path | None:
    """Select exactly one environment file.

    ``ENV_FILE`` is an explicit override for CI and diagnostics. Otherwise,
    development and production load only their matching file. Tests deliberately
    load no dotenv file so local credentials never enter the test process.
    """
    explicit = os.getenv("ENV_FILE")
    if explicit:
        return Path(explicit)

    app_env = os.getenv("APP_ENV", "development")
    if app_env == "test":
        return None
    return BACKEND_DIRECTORY / f".env.{app_env}"


def _secret_value(value: SecretStr | None) -> str | None:
    return value.get_secret_value() if value else None


def _hostname(value: str | SecretStr | None) -> str | None:
    if isinstance(value, SecretStr):
        value = value.get_secret_value()
    if not value:
        return None
    return urlparse(value).hostname


class Settings(BaseSettings):
    """Server configuration with strict development/production isolation."""

    model_config = SettingsConfigDict(
        env_file=None,
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Multi-Agent AI Analyst API"
    app_env: EnvironmentName = "development"
    api_v1_prefix: str = "/v1"
    log_level: str = "INFO"
    allowed_origins: str = "http://localhost:3000"

    jwt_secret_key: SecretStr | None = None
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 30
    refresh_token_expire_days: int = 7

    database_url: SecretStr | None = None
    analytics_database_url: SecretStr | None = None

    gemini_api_key: SecretStr | None = None
    gemini_model: str = "gemini-3.1-flash-lite"
    gemini_embedding_model: str = "gemini-embedding-001"
    embedding_dimensions: int = Field(default=768, ge=1)

    # Optional OpenAI-compatible gateway used only in local development.
    litellm_base_url: str | None = None
    litellm_master_key: SecretStr | None = None
    litellm_model: str = "flash-lite"
    litellm_embedding_model: str = "gemini-embedding"

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

    # Development normally refuses every remote endpoint. This is the escape
    # hatch for services that have no practical local stand-in on this machine
    # (e.g. no Docker/WSL): a comma-separated allow-list of setting names, such
    # as "QDRANT_URL,OBJECT_STORAGE_ENDPOINT". Anything remote and NOT listed
    # here still fails startup, so each exception stays deliberate and visible.
    dev_allow_remote: str = ""

    max_agent_steps: int = 8
    max_tool_calls: int = 5
    run_timeout_seconds: int = 60
    max_agent_revisions: int = Field(default=1, ge=0, le=3)
    max_result_rows: int = 100
    sql_statement_timeout_ms: int = 5000
    service_probe_timeout_seconds: float = 3.0
    enable_web_search: bool = False
    enable_sql_agent: bool = False
    enable_code_execution: bool = False
    enable_unauthenticated_demo_api: bool = False
    demo_tenant_id: str = "demo"
    demo_max_upload_bytes: int = Field(default=10_000_000, ge=1, le=10_000_000)
    demo_max_concurrent_runs: int = Field(default=1, ge=1, le=4)
    redis_url: SecretStr | None = None

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def use_model_gateway(self) -> bool:
        return bool(self.litellm_base_url)

    @property
    def dev_remote_allowlist(self) -> set[str]:
        return {
            name.strip().upper()
            for name in self.dev_allow_remote.split(",")
            if name.strip()
        }

    @model_validator(mode="after")
    def validate_environment_boundaries(self) -> "Settings":
        if self.app_env == "test":
            return self

        if self.app_env == "development":
            allowed = self.dev_remote_allowlist
            remote_settings = []
            for name in (
                "database_url",
                "qdrant_url",
                "object_storage_endpoint",
                "redis_url",
                "litellm_base_url",
            ):
                host = _hostname(getattr(self, name))
                if host and host not in _LOCAL_HOSTS and name.upper() not in allowed:
                    remote_settings.append(name.upper())
            if remote_settings:
                joined = ", ".join(remote_settings)
                raise ValueError(
                    f"development cannot use remote service endpoints: {joined}; "
                    "use local services, add the name to DEV_ALLOW_REMOTE to opt in "
                    "deliberately, or run with APP_ENV=production"
                )
            return self

        missing = []
        required_values = {
            "JWT_SECRET_KEY": _secret_value(self.jwt_secret_key),
            "DATABASE_URL": _secret_value(self.database_url),
            "QDRANT_URL": self.qdrant_url,
            "QDRANT_API_KEY": _secret_value(self.qdrant_api_key),
            "OBJECT_STORAGE_ENDPOINT": self.object_storage_endpoint,
            "OBJECT_STORAGE_REGION": self.object_storage_region,
            "OBJECT_STORAGE_ACCESS_KEY_ID": _secret_value(
                self.object_storage_access_key_id
            ),
            "OBJECT_STORAGE_SECRET_ACCESS_KEY": _secret_value(
                self.object_storage_secret_access_key
            ),
        }
        for name, value in required_values.items():
            if not value:
                missing.append(name)

        if self.use_model_gateway:
            if not _secret_value(self.litellm_master_key):
                missing.append("LITELLM_MASTER_KEY")
        elif not _secret_value(self.gemini_api_key):
            missing.append("GEMINI_API_KEY")

        if missing:
            raise ValueError(
                "production configuration is missing required values: "
                + ", ".join(sorted(missing))
            )

        if not self.cors_origins:
            raise ValueError("production ALLOWED_ORIGINS must contain the frontend origin")
        unsafe_origins = [
            origin
            for origin in self.cors_origins
            if (
                _hostname(origin) in _LOCAL_HOSTS
                or "your-frontend" in origin
                or urlparse(origin).scheme != "https"
            )
        ]
        if unsafe_origins:
            raise ValueError(
                "production ALLOWED_ORIGINS must not contain localhost or placeholders"
            )

        if self.object_storage_region == "auto":
            raise ValueError("production OBJECT_STORAGE_REGION must be provider-specific")
        if self.enable_sql_agent and not _secret_value(self.analytics_database_url):
            raise ValueError("production ANALYTICS_DATABASE_URL is required when SQL is enabled")
        if self.enable_unauthenticated_demo_api:
            raise ValueError("production must not enable the unauthenticated demo API")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=_select_env_file())
