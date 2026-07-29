"""FastAPI dependencies that derive principals from verified access tokens."""

from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.auth.service import AuthenticationError, AuthService, Principal
from app.core.config import get_settings
from app.db.session import get_session

_bearer = HTTPBearer(auto_error=False)


def get_current_principal(
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(_bearer)],
    session: Annotated[Session, Depends(get_session)],
) -> Principal:
    if not credentials or credentials.scheme.lower() != "bearer":
        raise _unauthorized()
    try:
        service = AuthService(session, get_settings())
        return service.principal_from_access_token(credentials.credentials)
    except AuthenticationError as exc:
        raise _unauthorized() from exc


def require_organization_admin(
    principal: Annotated[Principal, Depends(get_current_principal)],
) -> Principal:
    if principal.role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return principal


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={"WWW-Authenticate": "Bearer"},
    )
