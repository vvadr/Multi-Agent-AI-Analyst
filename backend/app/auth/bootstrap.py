"""Create the first invite-only organization administrator from protected env input."""

from __future__ import annotations

import argparse
import os
from getpass import getpass

from app.auth.service import AuthService, BootstrapError
from app.core.config import get_settings
from app.db.session import create_session


def main() -> None:
    parser = argparse.ArgumentParser(description="Bootstrap the first organization administrator")
    parser.add_argument("--email", required=True)
    parser.add_argument("--name", required=True)
    parser.add_argument("--organization", required=True)
    parser.add_argument(
        "--password-env",
        help="Environment variable containing the first administrator password",
    )
    args = parser.parse_args()
    password = os.getenv(args.password_env) if args.password_env else getpass("Password: ")
    if not password:
        raise SystemExit("A non-empty password is required")

    session = create_session()
    try:
        principal = AuthService(session, get_settings()).bootstrap_admin(
            email=args.email,
            password=password,
            display_name=args.name,
            organization_name=args.organization,
        )
    except (BootstrapError, ValueError) as exc:
        session.rollback()
        raise SystemExit("Administrator bootstrap did not complete") from exc
    finally:
        session.close()
    print(f"Created administrator for organization {principal.organization_id}")


if __name__ == "__main__":
    main()
