"""Transactional email — used only for password reset.

Registration and sign-in never send email, so a deployment with no provider
configured is fully functional; it simply has no self-service password reset,
and the UI hides the option rather than offering a dead end.

SMTP rather than a vendor SDK: every provider worth using (Resend, Postmark,
SES, Mailgun) speaks it, so the choice of provider stays a configuration
decision instead of a code change. The console sender writes the link to the log
instead of delivering it, which is enough to exercise the flow locally.
"""

from __future__ import annotations

import smtplib
from dataclasses import dataclass
from email.message import EmailMessage as MimeMessage
from typing import Protocol
from urllib.parse import quote

import structlog

from app.core.config import Settings

logger = structlog.get_logger(__name__)


@dataclass(frozen=True)
class EmailMessage:
    to: str
    subject: str
    body: str


class EmailSender(Protocol):
    def send(self, message: EmailMessage) -> None: ...


class ConsoleEmailSender:
    """Writes the message to the log instead of delivering it."""

    def send(self, message: EmailMessage) -> None:
        logger.info(
            "email_not_sent_console_mode",
            to=message.to,
            subject=message.subject,
            body=message.body,
        )


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        if not settings.smtp_host:
            raise ValueError("SMTP_HOST is required to send account email")
        self._host = settings.smtp_host
        self._port = settings.smtp_port
        self._username = settings.smtp_username
        self._password = (
            settings.smtp_password.get_secret_value() if settings.smtp_password else None
        )
        self._use_tls = settings.smtp_use_tls
        self._from = f"{settings.email_from_name} <{settings.email_from_address}>"
        self._timeout = max(5.0, settings.service_probe_timeout_seconds * 2)

    def send(self, message: EmailMessage) -> None:
        mime = MimeMessage()
        mime["From"] = self._from
        mime["To"] = message.to
        mime["Subject"] = message.subject
        mime.set_content(message.body)
        with smtplib.SMTP(self._host, self._port, timeout=self._timeout) as client:
            if self._use_tls:
                client.starttls()
            if self._username and self._password:
                client.login(self._username, self._password)
            client.send_message(mime)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.email_sender == "smtp":
        return SmtpEmailSender(settings)
    return ConsoleEmailSender()


def password_reset_message(*, settings: Settings, to: str, token: str) -> EmailMessage:
    link = f"{settings.public_app_url.rstrip('/')}/reset-password?token={quote(token, safe='')}"
    minutes = settings.password_reset_expire_minutes
    return EmailMessage(
        to=to,
        subject="Reset your password",
        body=(
            "We received a request to reset your password.\n\n"
            f"{link}\n\n"
            f"The link expires in {minutes} minutes. "
            "If you did not request this, your password has not changed and no "
            "action is needed."
        ),
    )
