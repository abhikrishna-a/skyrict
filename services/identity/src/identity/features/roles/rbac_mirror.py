"""Phase-1 RBAC mirror - keep core's ``core_roles``/``core_user_roles`` current.

Identity owns tenancy, role definitions, and user→role grants; core enforces
ERP ``require_permission`` from its own ``core_roles`` / ``core_user_roles``
tables. Those projections are refreshed on grant events, invite accepts, and
core boot - but a role edit (PATCH ``/roles/{id}``) and a member role change
(``MemberService.change_role``) produced none of those, so core kept enforcing
stale state: AI permissions added to a custom role stayed ``403``, and a
downgraded member kept the old role's grants forever.

These bridges follow the accepted invitation-accept pattern
(``identity.features.invitations.service``): a direct upsert over the shared
database, REPLACING permissions/grants (never merging) so removals propagate
too. Failures are logged, never raised - a missing or divergent mirror must
not fail the edit; the future event consumer or ``core provision-rbac`` heals
it.
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


class RbacGrantMirror:
    """Phase-1 grant mirror - keep core's ``core_user_roles`` current.

    The Kafka consumer is not wired yet, so role REVOCATIONS never reach core:
    ``MemberService.change_role`` swaps grants in identity's ``user_roles``
    only, and core's boot sync used to only ever ADD grants. A downgraded
    member keeps the old role's grants in ``core_user_roles`` forever - every
    ``require_permission`` edge and the AI assistant greeting still see the
    stale, broader access.

    This bridge replaces ONE user's grants to match identity's current
    ``user_roles`` (identity is authoritative): stale rows are deleted and
    current rows upserted, using the same direct-upsert-over-shared-DB
    pattern as ``RbacRoleMirror`` and the invitation-accept mirror. Failures
    are logged, never raised - the boot reconcile
    (``core.seed.sync_rbac_from_identity``) or the future event consumer
    heals it.
    """

    async def replace_user_grants(
        self, *, tenant_id: str | uuid.UUID, user_id: str | uuid.UUID
    ) -> None:
        """Replace one user's core grants with identity's current set.

        Deletes every ``core_user_roles`` row for the user/tenant that no
        longer maps to an identity ``user_roles`` row, then upserts the
        current grants (core role ids resolved by tenant+name, matching the
        boot sync's composite-PK shapes).
        """
        tid = uuid.UUID(str(tenant_id))
        uid = uuid.UUID(str(user_id))
        try:
            async with async_session_factory() as session:
                await session.execute(
                    text(
                        "DELETE FROM core_user_roles cur "
                        "WHERE cur.tenant_id = :tid AND cur.user_id = :uid "
                        "AND NOT EXISTS ("
                        "  SELECT 1 "
                        "  FROM user_roles ur "
                        "  JOIN roles r ON r.id = ur.role_id "
                        "  JOIN core_roles cr ON cr.tenant_id = r.tenant_id AND cr.name = r.name "
                        "  WHERE ur.tenant_id = cur.tenant_id "
                        "    AND ur.user_id = cur.user_id "
                        "    AND cr.id = cur.role_id "
                        "    AND ur.scope_id IS NOT DISTINCT FROM cur.scope_id "
                        ")"
                    ),
                    {"tid": tid, "uid": uid},
                )
                await session.execute(
                    text(
                        "INSERT INTO core_user_roles (tenant_id, id, user_id, role_id, scope_id) "
                        "SELECT ur.tenant_id, gen_random_uuid(), ur.user_id, cr.id, ur.scope_id "
                        "FROM user_roles ur "
                        "JOIN core_roles cr ON cr.tenant_id = ur.tenant_id AND cr.name = "
                        "  (SELECT r.name FROM roles r WHERE r.id = ur.role_id) "
                        "WHERE ur.tenant_id = :tid AND ur.user_id = :uid "
                        "ON CONFLICT DO NOTHING"
                    ),
                    {"tid": tid, "uid": uid},
                )
                await session.commit()
            logger.info(
                "rbac_mirror.grants_replaced",
                tenant_id=str(tenant_id),
                user_id=str(user_id),
            )
        except Exception:
            logger.exception(
                "rbac_mirror.grant_replace_failed",
                tenant_id=str(tenant_id),
                user_id=str(user_id),
            )
