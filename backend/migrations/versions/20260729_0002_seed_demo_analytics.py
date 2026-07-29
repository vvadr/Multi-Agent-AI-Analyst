"""Create the synthetic analytics source used by the local Phase 2 demo.

Revision ID: 20260729_0002
Revises: 20260728_0001
"""

from collections.abc import Sequence
from datetime import date

import sqlalchemy as sa
from alembic import op

revision: str = "20260729_0002"
down_revision: str | Sequence[str] | None = "20260728_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE SCHEMA IF NOT EXISTS analytics")
    monthly_metrics = op.create_table(
        "monthly_metrics",
        sa.Column("month", sa.Date(), nullable=False),
        sa.Column("region", sa.String(length=64), nullable=False),
        sa.Column("revenue", sa.Numeric(12, 2), nullable=False),
        sa.Column("active_customers", sa.Integer(), nullable=False),
        sa.PrimaryKeyConstraint("month", "region"),
        schema="analytics",
    )
    op.bulk_insert(
        monthly_metrics,
        [
            {
                "month": date(2026, 1, 1),
                "region": "East",
                "revenue": 125000,
                "active_customers": 840,
            },
            {
                "month": date(2026, 1, 1),
                "region": "West",
                "revenue": 98000,
                "active_customers": 720,
            },
            {
                "month": date(2026, 2, 1),
                "region": "East",
                "revenue": 132000,
                "active_customers": 865,
            },
            {
                "month": date(2026, 2, 1),
                "region": "West",
                "revenue": 104000,
                "active_customers": 755,
            },
        ],
    )


def downgrade() -> None:
    op.drop_table("monthly_metrics", schema="analytics")
