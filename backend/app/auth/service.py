"""Security-sensitive invite, credential, token, and refresh-session logic."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from uuid import UUID

import jwt
from pwdlib import PasswordHash
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import Settings
from app.db.models import (
    AuditEvent,
    Invite,
    Membership,
    Organization,
    PasswordResetToken,
    RefreshSession,
    User,
)

_PASSWORD_HASHER = PasswordHash.recommended()
_REFRESH_TOKEN_BYTES = 32


class AuthenticationError(Exception):
    """Authentication or authorization failed without exposing its cause."""


class InvitationError(Exception):
    """An invitation is invalid, expired, already consumed, or conflicted."""


class BootstrapError(Exception):
    """The one-time administrator bootstrap operation cannot continue."""


class EmailTakenError(Exception):
    """That address already has an account."""


@dataclass(frozen=True)
class Principal:
    user_id: UUID
    organization_id: UUID
    role: str
    email: str


@dataclass(frozen=True)
class IssuedSession:
    access_token: str
    refresh_token: str
    expires_in: int
    principal: Principal


@dataclass(frozen=True)
class CreatedInvite:
    id: UUID
    email: str
    expires_at: datetime
    token: str


def normalize_email(value: str) -> str:
    """Validate a small, dependency-free subset of mailbox syntax."""
    email = value.strip().casefold()
    local, separator, domain = email.partition("@")
    if (
        not separator
        or not local
        or not domain
        or "@" in domain
        or "." not in domain
        or len(email) > 320
    ):
        raise ValueError("email address is invalid")
    return email


def hash_refresh_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _is_expired(value: datetime) -> bool:
    if value.tzinfo is None:
        value = value.replace(tzinfo=UTC)
    return value <= _utc_now()


class AuthService:
    def __init__(self, session: Session, settings: Settings) -> None:
        self.session = session
        self.settings = settings

    def bootstrap_admin(
        self, *, email: str, password: str, display_name: str, organization_name: str
    ) -> Principal:
        normalized_email = normalize_email(email)
        if self.session.scalar(select(User.id).where(User.email == normalized_email)):
            raise BootstrapError("an account with this email already exists")
        organization = Organization(
            name=_required_text(organization_name, "organization name", 120)
        )
        user = User(
            email=normalized_email,
            display_name=_required_text(display_name, "display name", 120),
            password_hash=_hash_password(password),
        )
        self.session.add_all([organization, user])
        self.session.flush()
        membership = Membership(
            organization_id=organization.id,
            user_id=user.id,
            role="admin",
        )
        self.session.add(membership)
        self._audit(
            event_type="auth.admin_bootstrapped",
            organization_id=organization.id,
            actor_user_id=user.id,
            target_id=user.id,
        )
        self.session.commit()
        return Principal(
            user_id=user.id,
            organization_id=organization.id,
            role=membership.role,
            email=user.email,
        )

    def register(
        self, *, email: str, password: str, display_name: str, organization_name: str | None = None
    ) -> IssuedSession:
        """Create an account with its own organization and sign it in.

        There is no confirmation step. That is a deliberate product decision:
        the address is not used to authenticate anything, so gating first use on
        an emailed round trip would add a failure mode without adding a
        guarantee. The session is issued here so registering and signing in are
        one action rather than two.
        """
        normalized_email = normalize_email(email)
        name = _required_text(display_name, "display name", 120)
        if self.session.scalar(select(User.id).where(User.email == normalized_email)):
            raise EmailTakenError("an account with this email already exists")

        organization = Organization(
            name=_required_text(organization_name or f"{name}'s workspace", "organization", 120)
        )
        user = User(
            email=normalized_email,
            display_name=name,
            password_hash=_hash_password(password),
        )
        self.session.add_all([organization, user])
        self.session.flush()
        # The registrant administers the organization they just created; there
        # is nobody else who could.
        membership = Membership(
            organization_id=organization.id, user_id=user.id, role="admin"
        )
        self.session.add(membership)
        self.session.flush()

        principal = Principal(
            user_id=user.id,
            organization_id=organization.id,
            role=membership.role,
            email=user.email,
        )
        issued = self._issue_session(principal)
        self._audit(
            event_type="auth.registered",
            organization_id=organization.id,
            actor_user_id=user.id,
            target_id=user.id,
        )
        self.session.commit()
        return issued

    def request_password_reset(self, *, email: str) -> tuple[str, str] | None:
        """Mint a reset token, or None when the address has no active account."""
        try:
            normalized_email = normalize_email(email)
        except ValueError:
            return None
        user = self.session.scalar(select(User).where(User.email == normalized_email))
        if not user or not user.is_active:
            return None
        raw_token = secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)
        self.session.add(
            PasswordResetToken(
                user_id=user.id,
                token_hash=hash_refresh_token(raw_token),
                expires_at=_utc_now()
                + timedelta(minutes=self.settings.password_reset_expire_minutes),
            )
        )
        self.session.commit()
        return user.email, raw_token

    def reset_password(self, *, token: str, password: str) -> None:
        record = self.session.scalar(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == hash_refresh_token(token)
            )
        )
        if not record or record.consumed_at or _is_expired(record.expires_at):
            raise InvitationError("reset link is invalid")
        user = self.session.get(User, record.user_id)
        if not user or not user.is_active:
            raise InvitationError("reset link is invalid")

        user.password_hash = _hash_password(password)
        record.consumed_at = _utc_now()
        # Every existing session is now suspect: whoever prompted the reset may
        # be holding one.
        now = _utc_now()
        for session_record in self.session.scalars(
            select(RefreshSession).where(
                RefreshSession.user_id == user.id, RefreshSession.revoked_at.is_(None)
            )
        ):
            session_record.revoked_at = now
        membership = self.session.scalar(
            select(Membership).where(Membership.user_id == user.id)
        )
        self._audit(
            event_type="auth.password_reset",
            organization_id=membership.organization_id if membership else None,
            actor_user_id=user.id,
            target_id=user.id,
        )
        self.session.commit()

    def create_invite(
        self, *, principal: Principal, email: str, role: str = "member"
    ) -> CreatedInvite:
        normalized_email = normalize_email(email)
        if role not in {"admin", "member"}:
            raise InvitationError("invitation role is invalid")
        raw_token = secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)
        invite = Invite(
            organization_id=principal.organization_id,
            email=normalized_email,
            role=role,
            token_hash=hash_refresh_token(raw_token),
            expires_at=_utc_now() + timedelta(hours=self.settings.invite_expire_hours),
            created_by_user_id=principal.user_id,
        )
        self.session.add(invite)
        self.session.flush()
        self._audit(
            event_type="auth.invite_created",
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
            target_id=invite.id,
            details={"role": role},
        )
        self.session.commit()
        return CreatedInvite(
            id=invite.id,
            email=invite.email,
            expires_at=invite.expires_at,
            token=raw_token,
        )

    def accept_invite(
        self, *, token: str, password: str, display_name: str
    ) -> Principal:
        invite = self.session.scalar(
            select(Invite).where(Invite.token_hash == hash_refresh_token(token))
        )
        if not invite or invite.accepted_at or _is_expired(invite.expires_at):
            raise InvitationError("invitation is invalid")

        user = self.session.scalar(select(User).where(User.email == invite.email))
        if user:
            if not user.is_active or not _verify_password(password, user.password_hash):
                raise InvitationError("invitation is invalid")
        else:
            user = User(
                email=invite.email,
                display_name=_required_text(display_name, "display name", 120),
                password_hash=_hash_password(password),
            )
            self.session.add(user)
            self.session.flush()

        membership = self.session.scalar(
            select(Membership).where(
                Membership.organization_id == invite.organization_id,
                Membership.user_id == user.id,
            )
        )
        if not membership:
            membership = Membership(
                organization_id=invite.organization_id,
                user_id=user.id,
                role=invite.role,
            )
            self.session.add(membership)
            self.session.flush()

        invite.accepted_at = _utc_now()
        self._audit(
            event_type="auth.invite_accepted",
            organization_id=invite.organization_id,
            actor_user_id=user.id,
            target_id=invite.id,
        )
        self.session.commit()
        return Principal(
            user_id=user.id,
            organization_id=invite.organization_id,
            role=membership.role,
            email=user.email,
        )

    def login(
        self, *, email: str, password: str, organization_id: UUID | None = None
    ) -> IssuedSession:
        try:
            normalized_email = normalize_email(email)
        except ValueError as exc:
            raise AuthenticationError("invalid credentials") from exc
        user = self.session.scalar(select(User).where(User.email == normalized_email))
        if not user or not user.is_active or not _verify_password(password, user.password_hash):
            raise AuthenticationError("invalid credentials")

        membership = self._membership_for_login(user.id, organization_id)
        if not membership:
            raise AuthenticationError("invalid credentials")
        principal = Principal(
            user_id=user.id,
            organization_id=membership.organization_id,
            role=membership.role,
            email=user.email,
        )
        issued = self._issue_session(principal)
        self._audit(
            event_type="auth.login",
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
        )
        self.session.commit()
        return issued

    def refresh(self, *, refresh_token: str) -> IssuedSession:
        session_record = self.session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == hash_refresh_token(refresh_token)
            )
        )
        if not session_record:
            raise AuthenticationError("invalid refresh session")

        # A token that was already rotated away is being presented a second
        # time. Refusing it is not enough on its own: if it leaked, whoever holds
        # it also holds the successor it was exchanged for, and that successor
        # still works. So the lineage it leads to is revoked before answering.
        # A client that merely retried a refresh is signed out and can sign in
        # again, which is the cheaper of the two mistakes to make here.
        if session_record.revoked_at and session_record.replaced_by_session_id:
            self._revoke_session_lineage(session_record)
            self._audit(
                event_type="auth.refresh_reuse_detected",
                organization_id=session_record.organization_id,
                actor_user_id=session_record.user_id,
                target_id=session_record.id,
            )
            self.session.commit()
            raise AuthenticationError("invalid refresh session")

        if session_record.revoked_at or _is_expired(session_record.expires_at):
            raise AuthenticationError("invalid refresh session")

        user = self.session.get(User, session_record.user_id)
        membership = self.session.scalar(
            select(Membership).where(
                Membership.organization_id == session_record.organization_id,
                Membership.user_id == session_record.user_id,
            )
        )
        if not user or not user.is_active or not membership:
            raise AuthenticationError("invalid refresh session")

        principal = Principal(
            user_id=user.id,
            organization_id=membership.organization_id,
            role=membership.role,
            email=user.email,
        )
        session_record.revoked_at = _utc_now()
        issued = self._issue_session(principal)
        replacement = self.session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == hash_refresh_token(issued.refresh_token)
            )
        )
        if replacement:
            session_record.replaced_by_session_id = replacement.id
        self._audit(
            event_type="auth.refresh",
            organization_id=principal.organization_id,
            actor_user_id=principal.user_id,
        )
        self.session.commit()
        return issued

    def _revoke_session_lineage(self, session_record: RefreshSession) -> int:
        """Revoke a replayed session and every session descended from it.

        Rotation makes each refresh session the parent of at most one successor,
        so the descendants of a replayed token are exactly the sessions that
        token could have produced — the lineage a thief would be holding.
        Revoking that chain rather than every session the account has keeps the
        reader's other devices signed in, which matters because a retry can
        trigger this too.
        """
        now = _utc_now()
        revoked = 0
        seen: set[UUID] = set()
        current: RefreshSession | None = session_record
        while current and current.id not in seen:
            seen.add(current.id)
            if not current.revoked_at:
                current.revoked_at = now
                revoked += 1
            next_id = current.replaced_by_session_id
            current = self.session.get(RefreshSession, next_id) if next_id else None
        return revoked

    def logout(self, *, refresh_token: str | None) -> None:
        if not refresh_token:
            return
        session_record = self.session.scalar(
            select(RefreshSession).where(
                RefreshSession.token_hash == hash_refresh_token(refresh_token)
            )
        )
        if session_record and not session_record.revoked_at:
            session_record.revoked_at = _utc_now()
            self._audit(
                event_type="auth.logout",
                organization_id=session_record.organization_id,
                actor_user_id=session_record.user_id,
            )
            self.session.commit()

    def principal_from_access_token(self, token: str) -> Principal:
        secret = _jwt_secret(self.settings)
        try:
            payload = jwt.decode(
                token,
                secret,
                algorithms=[self.settings.jwt_algorithm],
                audience=self.settings.jwt_audience,
                issuer=self.settings.jwt_issuer,
            )
            if payload.get("typ") != "access":
                raise AuthenticationError("invalid token type")
            user_id = UUID(str(payload["sub"]))
            organization_id = UUID(str(payload["org"]))
        except (KeyError, ValueError, jwt.PyJWTError) as exc:
            raise AuthenticationError("invalid access token") from exc

        user = self.session.get(User, user_id)
        membership = self.session.scalar(
            select(Membership).where(
                Membership.organization_id == organization_id,
                Membership.user_id == user_id,
            )
        )
        if not user or not user.is_active or not membership:
            raise AuthenticationError("invalid access token")
        return Principal(
            user_id=user.id,
            organization_id=membership.organization_id,
            role=membership.role,
            email=user.email,
        )

    def _membership_for_login(
        self, user_id: UUID, organization_id: UUID | None
    ) -> Membership | None:
        statement = select(Membership).where(Membership.user_id == user_id)
        if organization_id:
            statement = statement.where(Membership.organization_id == organization_id)
        else:
            statement = statement.order_by(Membership.created_at.asc())
        return self.session.scalar(statement)

    def _issue_session(self, principal: Principal) -> IssuedSession:
        now = _utc_now()
        expires_at = now + timedelta(minutes=self.settings.access_token_expire_minutes)
        access_token = jwt.encode(
            {
                "sub": str(principal.user_id),
                "org": str(principal.organization_id),
                "typ": "access",
                "iss": self.settings.jwt_issuer,
                "aud": self.settings.jwt_audience,
                "iat": now,
                "exp": expires_at,
                "jti": secrets.token_urlsafe(16),
            },
            _jwt_secret(self.settings),
            algorithm=self.settings.jwt_algorithm,
        )
        refresh_token = secrets.token_urlsafe(_REFRESH_TOKEN_BYTES)
        self.session.add(
            RefreshSession(
                user_id=principal.user_id,
                organization_id=principal.organization_id,
                token_hash=hash_refresh_token(refresh_token),
                expires_at=now + timedelta(days=self.settings.refresh_token_expire_days),
            )
        )
        self.session.flush()
        return IssuedSession(
            access_token=access_token,
            refresh_token=refresh_token,
            expires_in=int((expires_at - now).total_seconds()),
            principal=principal,
        )

    def _audit(
        self,
        *,
        event_type: str,
        organization_id: UUID | None,
        actor_user_id: UUID | None,
        target_id: UUID | None = None,
        details: dict[str, object] | None = None,
    ) -> None:
        self.session.add(
            AuditEvent(
                event_type=event_type,
                organization_id=organization_id,
                actor_user_id=actor_user_id,
                target_id=target_id,
                details=details or {},
            )
        )


def _jwt_secret(settings: Settings) -> str:
    if not settings.jwt_secret_key:
        raise AuthenticationError("JWT signing is not configured")
    return settings.jwt_secret_key.get_secret_value()


def _hash_password(password: str) -> str:
    _validate_password(password)
    return _PASSWORD_HASHER.hash(password)


def _verify_password(password: str, password_hash: str) -> bool:
    try:
        return _PASSWORD_HASHER.verify(password, password_hash)
    except Exception:
        return False


def _validate_password(password: str) -> None:
    if len(password) < 12 or len(password) > 256:
        raise ValueError("password must be between 12 and 256 characters")


def _required_text(value: str, label: str, maximum: int) -> str:
    normalized = " ".join(value.split())
    if not normalized or len(normalized) > maximum:
        raise ValueError(f"{label} is invalid")
    return normalized
