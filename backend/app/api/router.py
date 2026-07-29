from fastapi import APIRouter

from app.api.routes.documents import router as documents_router
from app.api.routes.health import router as health_router
from app.api.routes.runs import router as runs_router

api_router = APIRouter()
api_router.include_router(health_router, tags=["operations"])

versioned_api_router = APIRouter()
versioned_api_router.include_router(health_router, tags=["operations"])
versioned_api_router.include_router(documents_router, tags=["documents"])
versioned_api_router.include_router(runs_router, tags=["runs"])
