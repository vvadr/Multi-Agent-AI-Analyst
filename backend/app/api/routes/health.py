from fastapi import APIRouter, Response, status

from app.core.config import get_settings
from app.services.readiness import check_readiness

router = APIRouter()


@router.get("/healthz")
def healthcheck() -> dict[str, str]:
    """Liveness endpoint with no external dependency check."""
    return {"status": "ok"}


@router.get("/readyz")
def readiness(response: Response) -> dict[str, object]:
    """Probe required dependencies without returning sensitive error details."""
    settings = get_settings()
    components = check_readiness(settings)
    ready = all(component["reachable"] for component in components.values())
    if not ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
    return {"status": "ready" if ready else "not_ready", "components": components}
