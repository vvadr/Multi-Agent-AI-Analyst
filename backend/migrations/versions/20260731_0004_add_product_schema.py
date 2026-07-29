"""Add durable product records, self-service account tokens, and usage counters.

Everything a user creates becomes a row here before any external service is
touched, so a restart between storage and indexing leaves a reconcilable record
rather than an orphan.

Revision ID: 20260731_0004
Revises: 20260730_0003
Create Date: 2026-07-31
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260731_0004"
down_revision: str | Sequence[str] | None = "20260730_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_NOW = sa.text("CURRENT_TIMESTAMP")


def _timestamps() -> list[sa.Column]:
    return [
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
    ]


def upgrade() -> None:
    # Existing accounts predate self-service signup and were created through an
    # invite, which already proves address ownership. Backfilling them to
    # verified keeps them able to sign in after this migration.
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(timezone=True)))
    op.execute("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL")

    for table in ("email_verification_tokens", "password_reset_tokens"):
        op.create_table(
            table,
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("user_id", sa.Uuid(), nullable=False),
            sa.Column("token_hash", sa.String(length=64), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("consumed_at", sa.DateTime(timezone=True)),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("token_hash"),
        )
        op.create_index(f"ix_{table}_user_id", table, ["user_id"])

    op.create_table(
        "documents",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("uploaded_by_user_id", sa.Uuid()),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=255), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("object_key", sa.String(length=512), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("chunk_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failure_reason", sa.String(length=64)),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('pending', 'processing', 'ready', 'failed', 'deleted')",
            name="ck_documents_status",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["uploaded_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_documents_organization_created", "documents", ["organization_id", "created_at"]
    )
    op.create_index(
        "ix_documents_organization_status", "documents", ["organization_id", "status"]
    )

    op.create_table(
        "runs",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("created_by_user_id", sa.Uuid()),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="queued"),
        sa.Column("answer", sa.Text()),
        sa.Column("error", sa.Text()),
        sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        *_timestamps(),
        sa.CheckConstraint(
            "status IN ('queued', 'running', 'completed', 'failed', 'cancelled')",
            name="ck_runs_status",
        ),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_runs_organization_created", "runs", ["organization_id", "created_at"])
    op.create_index("ix_runs_status_started", "runs", ["status", "started_at"])

    op.create_table(
        "run_events",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("sequence", sa.Integer(), nullable=False),
        sa.Column("event_type", sa.String(length=40), nullable=False),
        sa.Column("data", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "sequence", name="uq_run_events_run_sequence"),
    )
    op.create_index("ix_run_events_run_sequence", "run_events", ["run_id", "sequence"])

    op.create_table(
        "citations",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("reference", sa.String(length=120), nullable=False),
        sa.Column("kind", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("excerpt", sa.Text(), nullable=False),
        sa.Column("url", sa.String(length=2048)),
        sa.Column("document_id", sa.Uuid()),
        sa.Column("chunk_index", sa.Integer()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=_NOW, nullable=False),
        sa.CheckConstraint(
            "kind IN ('document', 'web', 'analytics')", name="ck_citations_kind"
        ),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "position", name="uq_citations_run_position"),
    )
    op.create_index("ix_citations_run_id", "citations", ["run_id"])

    op.create_table(
        "feedback",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("run_id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid()),
        sa.Column("rating", sa.Integer(), nullable=False),
        sa.Column("comment", sa.Text()),
        *_timestamps(),
        sa.CheckConstraint("rating IN (-1, 1)", name="ck_feedback_rating"),
        sa.ForeignKeyConstraint(["run_id"], ["runs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("run_id", "user_id", name="uq_feedback_run_user"),
    )
    op.create_index(
        "ix_feedback_organization_created", "feedback", ["organization_id", "created_at"]
    )

    op.create_table(
        "daily_usage",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("run_count", sa.Integer(), nullable=False, server_default="0"),
        *_timestamps(),
        sa.ForeignKeyConstraint(["organization_id"], ["organizations.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("organization_id", "usage_date", name="uq_daily_usage_org_date"),
    )


def downgrade() -> None:
    op.drop_table("daily_usage")
    op.drop_index("ix_feedback_organization_created", table_name="feedback")
    op.drop_table("feedback")
    op.drop_index("ix_citations_run_id", table_name="citations")
    op.drop_table("citations")
    op.drop_index("ix_run_events_run_sequence", table_name="run_events")
    op.drop_table("run_events")
    op.drop_index("ix_runs_status_started", table_name="runs")
    op.drop_index("ix_runs_organization_created", table_name="runs")
    op.drop_table("runs")
    op.drop_index("ix_documents_organization_status", table_name="documents")
    op.drop_index("ix_documents_organization_created", table_name="documents")
    op.drop_table("documents")
    for table in ("password_reset_tokens", "email_verification_tokens"):
        op.drop_index(f"ix_{table}_user_id", table_name=table)
        op.drop_table(table)
    op.drop_column("users", "email_verified_at")
