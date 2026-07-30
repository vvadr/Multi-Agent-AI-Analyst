"""Invite-only authentication endpoints.

Access tokens are returned only for in-memory browser use. Refresh tokens stay
in an HttpOnly cookie and are rotated on every successful refresh.
"""

from datetime import datetime
from typing import Annotated, Literal
from uuid import UUID

import structlog
from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import get_email_sender, get_rate_limiter
from app.auth.dependencies import get_current_principal, require_organization_admin
from app.auth.service import (
    AuthenticationError,
    AuthService,
    EmailTakenError,
    InvitationError,
    IssuedSession,
    Principal,
)
from app.core.config import Settings, get_settings
from app.db.session import get_session
from app.services.email import EmailMessage, password_reset_message
from app.services.rate_limit import client_identifier, enforce, rate_limit_key

logger = structlog.get_logger(__name__)

router = APIRouter(prefix="/auth")
REFRESH_COOKIE_NAME = "analyst_refresh"
DbSession = Annotated[Session, Depends(get_session)]

_FIFTEEN_MINUTES = 15 * 60
_ONE_HOUR = 60 * 60

# Signup, resend, and reset all answer identically whether or not the address is
# known. Anything else turns them into a way to test which addresses exist.
_NEUTRAL_ACCEPTED = {"status": "accepted"}


class LoginRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)
    organization_id: UUID | None = None


class InviteAcceptRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    password: str = Field(min_length=12, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)


class InviteCreateRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    role: Literal["admin", "member"] = "member"


class UserResponse(BaseModel):
    id: UUID
    email: str
    organization_id: UUID
    role: Literal["admin", "member"]


class TokenResponse(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"
    expires_in: int
    user: UserResponse


class InviteResponse(BaseModel):
    id: UUID
    email: str
    expires_at: datetime
    token: str


class SignupRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    password: str = Field(min_length=12, max_length=256)
    display_name: str = Field(min_length=1, max_length=120)
    organization_name: str | None = Field(default=None, max_length=120)


class EmailOnlyRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)


class PasswordResetRequest(BaseModel):
    token: str = Field(min_length=32, max_length=512)
    password: str = Field(min_length=12, max_length=256)


class AcceptedResponse(BaseModel):
    status: Literal["accepted"] = "accepted"


@router.post("/signup", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def signup(
    payload: SignupRequest,
    request: Request,
    response: Response,
    session: DbSession,
) -> TokenResponse:
    """Register an account and sign it in.

    There is no confirmation step, so this returns a session exactly as `login`
    does: the reader lands in their workspace rather than in their inbox.

    Unlike the endpoints that send email, this one does report a duplicate
    address. It has to — the reader must be told why their chosen address was
    refused, and a signup form that silently did nothing would be unusable. The
    enumeration this exposes is the same one any registration form exposes.
    """
    settings = get_settings()
    if not settings.enable_public_signup:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="Registration is closed"
        )
    _limit(
        request,
        "signup",
        settings.rate_limit_signup_per_hour,
        _ONE_HOUR,
        subject=payload.email,
        subject_limit=settings.rate_limit_signup_per_email_per_hour,
    )

    try:
        issued = AuthService(session, settings).register(
            email=payload.email,
            password=payload.password,
            display_name=payload.display_name,
            organization_name=payload.organization_name,
        )
    except EmailTakenError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="An account already exists for that email address.",
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Check your name, email address, and password.",
        ) from exc

    _set_refresh_cookie(response, issued.refresh_token, settings)
    return _token_response(issued)


@router.post(
    "/password-reset", response_model=AcceptedResponse, status_code=status.HTTP_202_ACCEPTED
)
def request_password_reset(
    payload: EmailOnlyRequest, request: Request, session: DbSession
) -> AcceptedResponse:
    settings = get_settings()
    if not settings.password_reset_available:
        # Better to say so than to accept the request and deliver nothing.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Password reset is not available on this deployment.",
        )
    _limit(
        request,
        "reset",
        settings.rate_limit_email_per_hour,
        _ONE_HOUR,
        subject=payload.email,
        subject_limit=settings.rate_limit_email_per_recipient_per_hour,
    )
    issued = AuthService(session, settings).request_password_reset(email=payload.email)
    if issued:
        email, token = issued
        _deliver(password_reset_message(settings=settings, to=email, token=token))
    return AcceptedResponse()


@router.post("/password-reset/confirm", response_model=AcceptedResponse)
def confirm_password_reset(
    payload: PasswordResetRequest, request: Request, session: DbSession
) -> AcceptedResponse:
    settings = get_settings()
    _limit(
        request,
        "reset-confirm",
        settings.rate_limit_email_per_hour,
        _ONE_HOUR,
        subject=payload.token,
        subject_limit=settings.rate_limit_email_per_recipient_per_hour,
    )
    try:
        AuthService(session, settings).reset_password(
            token=payload.token, password=payload.password
        )
    except (InvitationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That reset link is invalid or has expired.",
        ) from exc
    return AcceptedResponse()


@router.post("/login", response_model=TokenResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    session: DbSession,
) -> TokenResponse:
    settings = get_settings()
    _limit(
        request,
        "login",
        settings.rate_limit_login_per_15min,
        _FIFTEEN_MINUTES,
        subject=payload.email,
        subject_limit=settings.rate_limit_login_per_email_15min,
    )
    try:
        issued = AuthService(session, settings).login(
            email=payload.email,
            password=payload.password,
            organization_id=payload.organization_id,
        )
    except AuthenticationError as exc:
        raise _invalid_credentials() from exc
    _set_refresh_cookie(response, issued.refresh_token, settings)
    return _token_response(issued)


@router.post("/refresh", response_model=TokenResponse)
def refresh(
    request: Request,
    response: Response,
    session: DbSession,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> TokenResponse:
    settings = get_settings()
    _require_same_origin_for_cookie_auth(request, settings)
    _limit(request, "refresh", settings.rate_limit_refresh_per_15min, _FIFTEEN_MINUTES)
    try:
        issued = AuthService(session, settings).refresh(refresh_token=refresh_token or "")
    except AuthenticationError as exc:
        _clear_refresh_cookie(response, settings)
        raise _invalid_refresh() from exc
    _set_refresh_cookie(response, issued.refresh_token, settings)
    return _token_response(issued)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    request: Request,
    response: Response,
    session: DbSession,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE_NAME)] = None,
) -> None:
    settings = get_settings()
    _require_same_origin_for_cookie_auth(request, settings)
    AuthService(session, settings).logout(refresh_token=refresh_token)
    _clear_refresh_cookie(response, settings)


@router.post("/invites", response_model=InviteResponse, status_code=status.HTTP_201_CREATED)
def create_invite(
    payload: InviteCreateRequest,
    principal: Annotated[Principal, Depends(require_organization_admin)],
    session: DbSession,
) -> InviteResponse:
    settings = get_settings()
    enforce(
        get_rate_limiter(),
        settings=settings,
        key=rate_limit_key("invite", "organization", str(principal.organization_id)),
        limit=settings.rate_limit_invites_per_hour,
        window_seconds=_ONE_HOUR,
        unavailable="reject",
    )
    try:
        created = AuthService(session, settings).create_invite(
            principal=principal,
            email=payload.email,
            role=payload.role,
        )
    except (InvitationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Invalid invite",
        ) from exc
    return InviteResponse(
        id=created.id,
        email=created.email,
        expires_at=created.expires_at,
        token=created.token,
    )


@router.post("/invites/accept", response_model=UserResponse)
def accept_invite(
    payload: InviteAcceptRequest,
    request: Request,
    session: DbSession,
) -> UserResponse:
    # An invite token is a bearer credential; guessing it must be as expensive
    # as guessing a password.
    settings = get_settings()
    _limit(
        request,
        "invite-accept",
        settings.rate_limit_email_per_hour,
        _ONE_HOUR,
        subject=payload.token,
        subject_limit=settings.rate_limit_email_per_recipient_per_hour,
    )
    try:
        principal = AuthService(session, settings).accept_invite(
            token=payload.token,
            password=payload.password,
            display_name=payload.display_name,
        )
    except (InvitationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid invitation",
        ) from exc
    return _user_response(principal)


@router.get("/me", response_model=UserResponse)
def me(principal: Annotated[Principal, Depends(get_current_principal)]) -> UserResponse:
    return _user_response(principal)


def _limit(
    request: Request,
    bucket: str,
    limit: int,
    window_seconds: int,
    *,
    subject: str | None = None,
    subject_limit: int | None = None,
) -> None:
    settings = get_settings()
    limiter = get_rate_limiter()
    enforce(
        limiter,
        settings=settings,
        key=rate_limit_key(
            bucket,
            "ip",
            client_identifier(request, trust_forwarded_headers=settings.trust_proxy_headers),
        ),
        limit=limit,
        window_seconds=window_seconds,
    )
    if subject:
        enforce(
            limiter,
            settings=settings,
            key=rate_limit_key(bucket, "subject", subject),
            limit=subject_limit or limit,
            window_seconds=window_seconds,
        )


def _require_same_origin_for_cookie_auth(request: Request, settings: Settings) -> None:
    """Reject cross-site form posts that would otherwise send a SameSite=None cookie.

    The frontend and API are intentionally different origins, so the refresh
    cookie must use SameSite=None. Browser POSTs include Origin; requiring an
    origin from the configured frontend blocks a third-party site from rotating
    a reader's cookie or logging them out. Non-production keeps this relaxed so
    the local API and its test client remain convenient to use.
    """
    if settings.app_env != "production":
        return
    origin = request.headers.get("origin")
    if origin not in settings.cors_origins:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This request must come from the configured application origin.",
        )


def _deliver(message: EmailMessage) -> None:
    """Send account email without letting a provider outage fail the request.

    The account already exists at this point. Surfacing an SMTP error would
    tell the caller their signup failed when it did not; the recoverable path
    is the resend endpoint.
    """
    try:
        get_email_sender().send(message)
    except Exception:
        logger.exception("account_email_delivery_failed")


def _token_response(issued: IssuedSession) -> TokenResponse:
    # ``IssuedSession`` is intentionally not exported in route responses, so
    # only the access token leaves this boundary and the raw refresh token does not.
    return TokenResponse(
        access_token=issued.access_token,
        expires_in=issued.expires_in,
        user=_user_response(issued.principal),
    )


def _user_response(principal: Principal) -> UserResponse:
    return UserResponse(
        id=principal.user_id,
        email=principal.email,
        organization_id=principal.organization_id,
        role=principal.role,
    )


def _set_refresh_cookie(response: Response, refresh_token: str, settings: Settings) -> None:
    production = settings.app_env == "production"
    response.set_cookie(
        key=REFRESH_COOKIE_NAME,
        value=refresh_token,
        max_age=settings.refresh_token_expire_days * 24 * 60 * 60,
        httponly=True,
        secure=production,
        samesite="none" if production else "lax",
        path=f"{settings.api_v1_prefix}/auth",
    )


def _clear_refresh_cookie(response: Response, settings: Settings) -> None:
    response.delete_cookie(
        key=REFRESH_COOKIE_NAME,
        path=f"{settings.api_v1_prefix}/auth",
        secure=settings.app_env == "production",
        samesite="none" if settings.app_env == "production" else "lax",
    )


def _invalid_credentials() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid email or password",
        headers={"WWW-Authenticate": "Bearer"},
    )


def _invalid_refresh() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Your session has expired. Sign in again.",
        headers={"WWW-Authenticate": "Bearer"},
    )
