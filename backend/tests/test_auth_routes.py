from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.api.routes import auth as auth_routes
from app.auth import dependencies as auth_dependencies
from app.auth.service import AuthenticationError, AuthService
from app.core.config import Settings
from app.db.base import Base
from app.db.session import get_session
from app.main import app


@pytest.fixture
def auth_settings() -> Settings:
    return Settings(
        app_env="test",
        jwt_secret_key="a-test-secret-key-that-is-longer-than-thirty-two-characters",
    )


@pytest.fixture
def auth_client(
    auth_settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> Generator[tuple[TestClient, sessionmaker[Session]], None, None]:
    engine = create_engine(
        "sqlite+pysqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)

    def override_session() -> Generator[Session, None, None]:
        session = factory()
        try:
            yield session
        finally:
            session.close()

    monkeypatch.setattr(auth_routes, "get_settings", lambda: auth_settings)
    monkeypatch.setattr(auth_dependencies, "get_settings", lambda: auth_settings)
    app.dependency_overrides[get_session] = override_session
    with TestClient(app) as client:
        yield client, factory
    app.dependency_overrides.clear()
    Base.metadata.drop_all(engine)
    engine.dispose()


def bootstrap_admin(factory: sessionmaker[Session], settings: Settings) -> None:
    session = factory()
    try:
        AuthService(session, settings).bootstrap_admin(
            email="admin@example.test",
            password="correct-horse-battery-staple",
            display_name="Admin User",
            organization_name="Example Organization",
        )
    finally:
        session.close()


def login(client: TestClient) -> dict[str, object]:
    response = client.post(
        "/v1/auth/login",
        json={
            "email": "admin@example.test",
            "password": "correct-horse-battery-staple",
        },
    )
    assert response.status_code == 200
    return response.json()


def test_invite_acceptance_login_refresh_and_logout(
    auth_client: tuple[TestClient, sessionmaker[Session]], auth_settings: Settings
) -> None:
    client, factory = auth_client
    bootstrap_admin(factory, auth_settings)

    logged_in = login(client)
    access_token = str(logged_in["access_token"])
    invite = client.post(
        "/v1/auth/invites",
        headers={"Authorization": f"Bearer {access_token}"},
        json={"email": "analyst@example.test"},
    )
    assert invite.status_code == 201
    invitation_token = invite.json()["token"]

    accepted = client.post(
        "/v1/auth/invites/accept",
        json={
            "token": invitation_token,
            "password": "another-strong-password",
            "display_name": "Analyst User",
        },
    )
    assert accepted.status_code == 200
    assert accepted.json()["email"] == "analyst@example.test"

    second_login = client.post(
        "/v1/auth/login",
        json={
            "email": "analyst@example.test",
            "password": "another-strong-password",
        },
    )
    assert second_login.status_code == 200

    old_refresh = client.cookies.get("analyst_refresh")
    refreshed = client.post("/v1/auth/refresh")
    assert refreshed.status_code == 200
    assert client.cookies.get("analyst_refresh") != old_refresh

    me = client.get(
        "/v1/auth/me",
        headers={"Authorization": f"Bearer {refreshed.json()['access_token']}"},
    )
    assert me.status_code == 200
    assert me.json()["email"] == "analyst@example.test"

    logged_out = client.post("/v1/auth/logout")
    assert logged_out.status_code == 204
    assert client.cookies.get("analyst_refresh") is None
    assert client.post("/v1/auth/refresh").status_code == 401


def test_protected_invite_route_rejects_missing_malformed_and_member_tokens(
    auth_client: tuple[TestClient, sessionmaker[Session]], auth_settings: Settings
) -> None:
    client, factory = auth_client
    bootstrap_admin(factory, auth_settings)
    assert client.post("/v1/auth/invites", json={"email": "new@example.test"}).status_code == 401
    assert (
        client.post(
            "/v1/auth/invites",
            headers={"Authorization": "Bearer not-a-token"},
            json={"email": "new@example.test"},
        ).status_code
        == 401
    )

    session = factory()
    try:
        service = AuthService(session, auth_settings)
        admin = service.login(email="admin@example.test", password="correct-horse-battery-staple")
        invite = service.create_invite(
            principal=admin.principal,
            email="member@example.test",
        )
        service.accept_invite(
            token=invite.token,
            password="a-different-strong-password",
            display_name="Member User",
        )
        member = service.login(
            email="member@example.test",
            password="a-different-strong-password",
        )
    finally:
        session.close()

    denied = client.post(
        "/v1/auth/invites",
        headers={"Authorization": f"Bearer {member.access_token}"},
        json={"email": "not-allowed@example.test"},
    )
    assert denied.status_code == 403


def test_rotated_refresh_token_is_revoked(
    auth_client: tuple[TestClient, sessionmaker[Session]], auth_settings: Settings
) -> None:
    _, factory = auth_client
    bootstrap_admin(factory, auth_settings)
    session = factory()
    try:
        service = AuthService(session, auth_settings)
        original = service.login(
            email="admin@example.test",
            password="correct-horse-battery-staple",
        )
        replacement = service.refresh(refresh_token=original.refresh_token)
        with pytest.raises(AuthenticationError):
            service.refresh(refresh_token=original.refresh_token)
        assert replacement.refresh_token != original.refresh_token
    finally:
        session.close()
