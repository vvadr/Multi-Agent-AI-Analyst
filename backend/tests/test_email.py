"""Account email: link construction, sender selection, and SMTP delivery."""

from __future__ import annotations

from typing import Any

import pytest

from app.core.config import Settings
from app.services import email as email_module
from app.services.email import (
    ConsoleEmailSender,
    EmailMessage,
    SmtpEmailSender,
    build_email_sender,
    password_reset_message,
)


def _settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {"app_env": "test", "public_app_url": "https://app.example.com"}
    values.update(overrides)
    return Settings(**values)


# -------------------------------------------------------------- messages


def test_the_reset_message_states_its_expiry_and_reassures() -> None:
    settings = _settings(password_reset_expire_minutes=45)

    message = password_reset_message(settings=settings, to="a@b.test", token="t")

    assert "45 minutes" in message.body
    # Someone who did not request this needs to know they need do nothing.
    assert "no action is needed" in message.body


# --------------------------------------------------------------- senders


def test_the_console_sender_does_not_raise() -> None:
    ConsoleEmailSender().send(EmailMessage(to="a@b.test", subject="s", body="b"))


def test_the_factory_returns_the_console_sender_by_default() -> None:
    assert isinstance(build_email_sender(_settings()), ConsoleEmailSender)


def test_the_factory_returns_the_smtp_sender_when_selected() -> None:
    settings = _settings(email_sender="smtp", smtp_host="smtp.example.com")

    assert isinstance(build_email_sender(settings), SmtpEmailSender)


def test_the_smtp_sender_requires_a_host() -> None:
    with pytest.raises(ValueError, match="SMTP_HOST"):
        SmtpEmailSender(_settings(email_sender="smtp"))


class _FakeSmtp:
    instances: list[_FakeSmtp] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        self.host = host
        self.port = port
        self.started_tls = False
        self.logged_in_as: str | None = None
        self.sent: list[Any] = []
        _FakeSmtp.instances.append(self)

    def __enter__(self) -> _FakeSmtp:
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def starttls(self) -> None:
        self.started_tls = True

    def login(self, username: str, password: str) -> None:
        self.logged_in_as = username

    def send_message(self, message: Any) -> None:
        self.sent.append(message)


def test_the_smtp_sender_negotiates_tls_and_authenticates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeSmtp.instances.clear()
    monkeypatch.setattr(email_module.smtplib, "SMTP", _FakeSmtp)
    sender = SmtpEmailSender(
        _settings(
            email_sender="smtp",
            smtp_host="smtp.example.com",
            smtp_username="mailer",
            smtp_password="secret",
            email_from_address="no-reply@example.com",
        )
    )

    sender.send(EmailMessage(to="reader@example.test", subject="Hello", body="Body"))

    delivered = _FakeSmtp.instances[0]
    assert delivered.started_tls is True
    assert delivered.logged_in_as == "mailer"
    assert delivered.sent[0]["To"] == "reader@example.test"
    assert delivered.sent[0]["Subject"] == "Hello"


def test_the_smtp_sender_skips_login_without_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _FakeSmtp.instances.clear()
    monkeypatch.setattr(email_module.smtplib, "SMTP", _FakeSmtp)
    sender = SmtpEmailSender(_settings(email_sender="smtp", smtp_host="smtp.example.com"))

    sender.send(EmailMessage(to="a@b.test", subject="s", body="b"))

    assert _FakeSmtp.instances[0].logged_in_as is None


def test_the_reset_link_points_at_the_browser_app() -> None:
    message = password_reset_message(
        settings=_settings(), to="reader@example.test", token="tok123"
    )

    assert "https://app.example.com/reset-password?token=tok123" in message.body
    assert message.to == "reader@example.test"


def test_a_trailing_slash_on_the_app_url_does_not_double_up() -> None:
    settings = _settings(public_app_url="https://app.example.com/")

    message = password_reset_message(settings=settings, to="a@b.test", token="t")

    assert "https://app.example.com/reset-password" in message.body
    assert "com//reset" not in message.body


def test_a_token_with_url_characters_is_escaped() -> None:
    message = password_reset_message(settings=_settings(), to="a@b.test", token="a+b/c=")

    assert "a%2Bb%2Fc%3D" in message.body


def test_reset_is_unavailable_without_a_configured_smtp_host() -> None:
    # The console sender only writes to a log, so offering reset would be a
    # dead end rather than a feature.
    assert _settings().password_reset_available is False
    assert _settings(email_sender="smtp").password_reset_available is False
    assert (
        _settings(email_sender="smtp", smtp_host="smtp.example.com").password_reset_available
        is True
    )
