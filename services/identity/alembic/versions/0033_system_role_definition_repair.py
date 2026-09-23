"""Repair system roles against SYSTEM_ROLE_DEFINITIONS (owner drift closure).

History (why this carrier exists): the owner role carries the ``*`` wildcard
in its permission array, but the roles API previously allowed permission edits
on any role and the validator rejects keys outside the platform catalog
(including ``*``). A save that kept ``*`` failed; a save that dropped it
succeeded quietly, permanently shrinking the owner's access in that tenant
(e.g. to only ``invitations:send``). No job repaired the damage, so the data
kept drifting - owners resolved to a handful of permissions while the roles UI
showed the owner role as "a few permissions selected".

This data-repair carrier rewrites every *system* role's permission array to the
platform definition (custom roles are untouched), restoring the owner's
full-access wildcard and any other drifted system role. Idempotent by
construction: re-running overwrites the same arrays. The definitions below are
the frozen snapshot at migration authoring time - later definition changes
propagate to existing tenants through the boot-time reconcile
(``identity.features.roles.reconcile``), not by editing this carrier.

Revision ID: 0033
Revises: 0032
Create Date: 2026-09-22
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None

# Frozen snapshot of SYSTEM_ROLE_DEFINITIONS (core/constants.py) at authoring
# time. Deliberately self-contained: migrations must not import app code.
_SYSTEM_ROLE_DEFINITIONS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("tenant_owner", ("*", "invitations:send")),
    (
        "organization_admin",
        (
            "users:read",
            "users:write",
            "users:delete",
            "roles:read",
            "roles:write",
            "tenants:read",
            "tenants:write",
            "sessions:read",
            "sessions:revoke",
            "audit:read",
            "mfa:manage",
            "sso:manage",
            "settings:read",
            "settings:write",
            "erp.invoice.read",
            "erp.invoice.approve",
            "erp.purchase.approve",
            "erp.crm.read",
            "erp.crm.write",
            "erp.sales.read",
            "erp.sales.write",
            "erp.sales.approve",
            "erp.inventory.read",
            "erp.inventory.write",
            "erp.inventory.approve",
            "erp.inventory.ai.approve",
            "erp.inventory.adjust",
            "erp.inventory.adjust.approve",
            "erp.inventory.cost",
            "erp.inventory.suppliers.read",
            "erp.inventory.suppliers.write",
            "erp.finance.read",
            "erp.finance.write",
            "erp.finance.approve",
            "erp.hr.read",
            "erp.hr.write",
            "erp.hr.approve",
            "erp.hr.ai.eval",
            "erp.hr.ai.management",
            "erp.payroll.read",
            "erp.payroll.write",
            "erp.payroll.approve",
            "erp.payroll.ai.read",
            "erp.payroll.ai.run",
            "erp.payroll.ai.notify",
            "erp.payroll.ai.approve",
            "erp.ai.invoke",
            "erp.ai.narrator.refresh",
            "erp.ai.l3.refresh",
            "erp.ai.coaching.read",
            "erp.ai.coaching.review",
            "erp.ai.guardian.read",
            "erp.ai.guardian.review",
            "erp.reports.read",
            "erp.reports.create",
            "agents:read",
            "intelligence:read",
            "billing.manage",
            "invitations:send",
        ),
    ),
    (
        "department_manager",
        (
            "users:read",
            "roles:read",
            "settings:read",
            "sessions:read",
            "erp.invoice.read",
            "erp.crm.read",
            "erp.crm.write",
            "erp.sales.read",
            "erp.sales.write",
            "erp.inventory.read",
            "erp.inventory.write",
            "erp.inventory.ai.approve",
            "erp.finance.read",
            "erp.finance.write",
            "erp.hr.read",
            "erp.hr.write",
            "erp.payroll.read",
            "erp.reports.read",
        ),
    ),
    (
        "standard_user",
        (
            "users:read",
            "settings:read",
            "erp.invoice.read",
            "erp.crm.read",
            "erp.sales.read",
            "erp.inventory.read",
            "erp.finance.read",
            "erp.hr.read",
        ),
    ),
    (
        "auditor",
        (
            "audit:read",
            "sessions:read",
            "users:read",
            "roles:read",
            "erp.invoice.read",
            "erp.crm.read",
            "erp.sales.read",
            "erp.inventory.read",
            "erp.finance.read",
            "erp.hr.read",
            "erp.payroll.read",
            "erp.payroll.ai.read",
            "erp.reports.read",
        ),
    ),
    ("employee_self_service", ("erp.leave.self",)),
)


def upgrade() -> None:
    bind = op.get_bind()
    for name, permissions in _SYSTEM_ROLE_DEFINITIONS:
        bind.execute(
            text(
                "UPDATE roles SET permissions = CAST(:permissions AS text[]) "
                "WHERE name = :name AND is_system_role = TRUE"
            ),
            {
                # Bind a real list: asyncpg encodes Python lists natively for
                # text[] columns. Binding the rendered literal as a string
                # fails with DataError ("a sized iterable container expected")
                # because asyncpg must encode the parameter before Postgres
                # ever sees the CAST.
                "permissions": list(permissions),
                "name": name,
            },
        )


def downgrade() -> None:
    """No-op: drift repair is one-way and previous arrays are unrecoverable
    in general. The boot-time reconcile keeps system roles aligned from here
    on; a downgrade must not re-introduce stale arrays."""
    pass
