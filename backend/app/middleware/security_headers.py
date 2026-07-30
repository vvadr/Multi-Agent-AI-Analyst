"""Small, API-appropriate browser security headers.

The frontend sets its own CSP. These headers protect the API origin as well,
which matters because it receives credentialed browser requests and can be
visited directly even though it does not serve an HTML application.
"""

from starlette.datastructures import MutableHeaders
from starlette.types import ASGIApp, Message, Receive, Scope, Send


class SecurityHeadersMiddleware:
    """Attach defensive headers without buffering normal or streaming responses."""

    def __init__(self, app: ASGIApp, *, production: bool) -> None:
        self.app = app
        self.production = production

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        async def send_with_security_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = MutableHeaders(scope=message)
                headers.setdefault("X-Content-Type-Options", "nosniff")
                headers.setdefault("X-Frame-Options", "DENY")
                headers.setdefault("Referrer-Policy", "no-referrer")
                headers.setdefault(
                    "Permissions-Policy", "camera=(), geolocation=(), microphone=()"
                )
                headers.setdefault("X-Permitted-Cross-Domain-Policies", "none")

                path = scope.get("path", "")
                if "/auth/" in path:
                    headers.setdefault("Cache-Control", "no-store")
                if self.production:
                    headers.setdefault(
                        "Content-Security-Policy",
                        "base-uri 'none'; default-src 'none'; frame-ancestors 'none'",
                    )
                    headers.setdefault(
                        "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
                    )
            await send(message)

        await self.app(scope, receive, send_with_security_headers)
