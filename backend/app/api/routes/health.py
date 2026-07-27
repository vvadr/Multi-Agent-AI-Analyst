from fastapi import APIRouter, Response, status

from app.core.config import get_settings

router = APIRouter()


@router.get("/healthz")
def healthcheck() -> dict[str, str]:
    """Liveness endpoint with no external dependency check."""
    return {"status": "ok"}


@router.get("/readyz")
def readiness(response: Response) -> dict[str, object]:
    """Report configured dependencies without returning credentials."""
    settings = get_settings()
    components = {
        "database": bool(settings.database_url),
        "gemini": bool(settings.gemini_api_key),
        "qdrant": bool(settings.qdrant_url and settings.qdrant_api_key),
    }
    ready = all(components.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "not_ready", "components": components}
