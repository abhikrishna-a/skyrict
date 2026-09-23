"""Phase-1 RBAC mirror - keep core's ``core_roles`` projection current on edits.

Identity owns tenancy + role definitions; core enforces ERP
``require_permission`` from its own ``core_roles`` / ``core_user_roles``
tables. That projection is refreshed on grant events, invite accepts, and core
boot - but a role edit (PATCH ``/roles/{id}``) produced none of those, so core
kept enforcing the pre-edit permission array: AI permissions added to an
existing custom role stayed ``403`` until a grant or core restart re-mirrored
the row.

This bridge follows the accepted invitation-accept pattern
(``identity.features.invitations.service``): a direct upsert into
``core_roles`` over the shared database, REPLACING permissions (never merging)
so removals propagate too. Failures are logged, never raised - a missing or
divergent mirror must not fail the role edit; the future event consumer or
``core provision-rbac`` heals it.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import structlog
from sqlalchemy import text

from identity.db.session import async_session_factory

if TYPE_CHECKING:
    from identity.domain.entities import Role

logger = structlog.get_logger("identity.roles.rbac_mirror")


class RbacRoleMirror:
    """Upsert a role into ``core_roles``, replacing its permission array."""

    async def mirror_role(self, *, tenant_id: str | uuid.UUID, role: Role) -> None:
        """Mirror one role definition; log failures, never raise."""
        role_id = role.id
        if role_id is None:
            logger.warning("rbac_mirror.skipped_missing_role_id", role=role.name)
            return
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text(
                        "INSERT INTO core_roles (tenant_id, id, name, permissions, is_system_role) "
                        "VALUES (:tid, :rid, :rname, :perms, :sys) "
                        "ON CONFLICT (tenant_id, name) DO UPDATE SET "
                        "permissions = EXCLUDED.permissions, "
                        "is_system_role = EXCLUDED.is_system_role, updated_at = now()"
                    ),
                    {
                        "tid": uuid.UUID(str(tenant_id)),
                        "rid": role_id,
                        "rname": role.name,
                        "perms": list(role.permissions),
                        "sys": role.is_system_role,
                    },
                )
                await session.commit()
            logger.info(
                "rbac_mirror.role_synced",
                tenant_id=str(tenant_id),
                role=role.name,
                permission_count=len(role.permissions),
            )
        except Exception:
            logger.exception(
                "rbac_mirror.failed",
                tenant_id=str(tenant_id),
                role=role.name,
            )
