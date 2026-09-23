"""Cross-service RBAC provisioning integration tests - real Postgres.

Covers the event-driven core-RBAC provisioning path (identity -> core): the
idempotent ``apply_role_grants`` upsert, the ``provision_tenant_rbac`` entry
point, the ``handle_event`` consumer dispatch for the
``identity.tenant.provisioned``, ``identity.rbac.role_granted``, and
``identity.rbac.role_updated`` envelopes, the boot
``sync_rbac_from_identity`` replace semantics, and that ``RbacRepository``
resolves the provisioned grants at request time.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import pytest
from sqlalchemy import func, select, text

from core.db.rbac import RbacRepository, grants_permission
from core.db.session import async_session_factory
from core.events.consumers import handle_event
from core.events.consumers.rbac import apply_role_grants, provision_tenant_rbac
from core.models.core_role import CoreRoleModel
from core.models.core_user_role import CoreUserRoleModel
from core.models.tenant import TenantModel
from skyrict_events.schemas import (
    RbacRoleGranted,
    RbacRoleUpdated,
    RoleGrant,
    TenantProvisioned,
)

if TYPE_CHECKING:
    from collections.abc import AsyncGenerator

pytestmark = pytest.mark.integration


@pytest.fixture
async def tenant(migrated_schema: None) -> AsyncGenerator[str, None]:
    """One fresh tenant per test; cleaned up afterwards."""
    tenant_id = str(uuid.uuid4())
    async with async_session_factory() as session:
        session.add(
            TenantModel(
                id=uuid.UUID(tenant_id),
                name="RBAC Tenant",
                slug=f"rbac-{tenant_id[:8]}",
                plan_tier="free",
                is_active=True,
            )
        )
        await session.commit()
    try:
        yield tenant_id
    finally:
        async with async_session_factory() as session:
            await session.execute(
                text("DELETE FROM tenants WHERE id = :tid"), {"tid": uuid.UUID(tenant_id)}
            )
            await session.commit()


def _snapshot_payload(tenant_id: str, user_id: str) -> list[dict[str, object]]:
    return [
        {
            "role_id": str(uuid.uuid4()),
            "role_name": "tenant_owner",
            "permissions": ["*", "invitations:send"],
            "is_system_role": True,
            "user_id": user_id,
            "scope_id": tenant_id,
        },
        {
            "role_id": str(uuid.uuid4()),
            "role_name": "auditor",
            "permissions": ["erp.inventory.read", "erp.crm.read"],
            "is_system_role": True,
            "user_id": None,
            "scope_id": None,
        },
    ]


async def _count_rows(tenant_id: str) -> tuple[int, int]:
    async with async_session_factory() as session:
        roles = (
            await session.execute(
                select(func.count())
                .select_from(CoreRoleModel)
                .where(CoreRoleModel.tenant_id == uuid.UUID(tenant_id))
            )
        ).scalar_one()
        grants = (
            await session.execute(
                select(func.count())
                .select_from(CoreUserRoleModel)
                .where(CoreUserRoleModel.tenant_id == uuid.UUID(tenant_id))
            )
        ).scalar_one()
    return roles, grants


class TestProvisionTenantRbac:
    async def test_first_run_creates_roles_and_owner_grant(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        payload = _snapshot_payload(tenant, user_id)

        result = await provision_tenant_rbac(tenant, payload)

        assert result.roles_created == 2
        assert result.grants_created == 1
        assert result.roles_updated == 0
        assert result.grants_skipped == 0
        roles, grants = await _count_rows(tenant)
        assert roles == 2
        assert grants == 1

    async def test_rerun_is_idempotent(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        payload = _snapshot_payload(tenant, user_id)

        await provision_tenant_rbac(tenant, payload)
        result = await provision_tenant_rbac(tenant, payload)

        assert result.roles_created == 0
        assert result.grants_created == 0
        assert result.roles_updated == 2
        assert result.grants_skipped == 1
        roles, grants = await _count_rows(tenant)
        assert roles == 2
        assert grants == 1

    async def test_permission_changes_are_applied(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        payload = _snapshot_payload(tenant, user_id)
        await provision_tenant_rbac(tenant, payload)

        payload[0]["permissions"] = ["*"]
        result = await provision_tenant_rbac(tenant, payload)

        assert result.roles_updated == 2
        async with async_session_factory() as session:
            owner = await session.scalar(
                select(CoreRoleModel).where(
                    CoreRoleModel.tenant_id == uuid.UUID(tenant),
                    CoreRoleModel.name == "tenant_owner",
                )
            )
        assert owner is not None
        assert owner.permissions == ["*"]


class TestApplyRoleGrantsTransaction:
    async def test_caller_controls_commit(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        payload = _snapshot_payload(tenant, user_id)

        async with async_session_factory() as session:
            result = await apply_role_grants(session, tenant, payload)
            assert result.roles_created == 2
            await session.rollback()

        roles, grants = await _count_rows(tenant)
        assert roles == 0
        assert grants == 0


class TestRbacRepositoryResolution:
    async def test_provisioned_grants_resolve(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        payload = _snapshot_payload(tenant, user_id)
        await provision_tenant_rbac(tenant, payload)

        async with async_session_factory() as session:
            permissions = await RbacRepository(session).resolve_user_permissions(
                user_id=uuid.UUID(user_id), tenant_id=uuid.UUID(tenant)
            )

        assert sorted(permissions) == ["*", "invitations:send"]
        assert grants_permission(permissions, "erp.inventory.read")
        assert grants_permission(permissions, "erp.inventory.write")


class TestHandleEvent:
    async def test_tenant_provisioned_envelope(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        event = TenantProvisioned(
            tenant_id=tenant,
            slug="provisioned-tenant",
            role_grants=[
                RoleGrant(
                    role_id=str(uuid.uuid4()),
                    role_name="tenant_owner",
                    permissions=["*"],
                    user_id=user_id,
                    scope_id=tenant,
                )
            ],
        )

        result = await handle_event(event.to_dict())

        assert result is not None
        assert result.roles_created == 1
        assert result.grants_created == 1

    async def test_rbac_role_granted_envelope(self, tenant: str) -> None:
        user_id = str(uuid.uuid4())
        role_id = str(uuid.uuid4())
        event = RbacRoleGranted(
            tenant_id=tenant,
            grant=RoleGrant(
                role_id=role_id,
                role_name="department_manager",
                permissions=["erp.inventory.read", "erp.inventory.write"],
                is_system_role=False,
                user_id=user_id,
                scope_id=tenant,
            ),
        )

        result = await handle_event(event.to_dict())

        assert result is not None
        assert result.roles_created == 1
        assert result.grants_created == 1
        async with async_session_factory() as session:
            role = await session.get(CoreRoleModel, (uuid.UUID(tenant), uuid.UUID(role_id)))
        assert role is not None
        assert role.is_system_role is False

    async def test_rbac_role_updated_envelope(self, tenant: str) -> None:
        """Definition-only envelope (no user grant) upserts + replaces perms."""
        role_id = str(uuid.uuid4())
        event = RbacRoleUpdated(
            tenant_id=tenant,
            role=RoleGrant(
                role_id=role_id,
                role_name="ops_custom",
                permissions=["erp.finance.read", "erp.ai.invoke"],
                is_system_role=False,
            ),
        )

        result = await handle_event(event.to_dict())

        assert result is not None
        assert result.roles_created == 1
        assert result.grants_created == 0
        async with async_session_factory() as session:
            role = await session.get(CoreRoleModel, (uuid.UUID(tenant), uuid.UUID(role_id)))
        assert role is not None
        assert role.permissions == ["erp.finance.read", "erp.ai.invoke"]
        assert role.is_system_role is False

        # A newer definition REPLACES: the removed key stops being enforced.
        updated = RbacRoleUpdated(
            tenant_id=tenant,
            role=RoleGrant(
                role_id=role_id,
                role_name="ops_custom",
                permissions=["erp.ai.invoke"],
                is_system_role=False,
            ),
        )
        result = await handle_event(updated.to_dict())

        assert result is not None
        assert result.roles_updated == 1
        async with async_session_factory() as session:
            role = await session.get(CoreRoleModel, (uuid.UUID(tenant), uuid.UUID(role_id)))
        assert role is not None
        assert role.permissions == ["erp.ai.invoke"]

    async def test_unknown_event_type_is_ignored(self) -> None:
        result = await handle_event({"event_type": "identity.user.created", "user_id": "u-1"})
        assert result is None


class TestSyncRbacFromIdentityReplace:
    """Boot sync must REPLACE role permissions, never union (revocations too)."""

    async def test_role_permission_edit_propagates(self, tenant: str) -> None:
        from core.seed import sync_rbac_from_identity

        role_id = uuid.uuid4()
        async with async_session_factory() as session:
            # identity's roles row (authoritative) reflects the current edit
            await session.execute(
                text(
                    "INSERT INTO roles (id, tenant_id, name, permissions, is_system_role) "
                    "VALUES (:rid, :tid, :rname, :perms, false)"
                ),
                {
                    "rid": role_id,
                    "tid": uuid.UUID(tenant),
                    "rname": "ops_custom",
                    "perms": ["erp.finance.read", "erp.ai.invoke"],
                },
            )
            # core projection is STALE - mirrored before the AI keys were added
            await session.execute(
                text(
                    "INSERT INTO core_roles (tenant_id, id, name, permissions, is_system_role) "
                    "VALUES (:tid, :rid, :rname, :stale, false)"
                ),
                {
                    "tid": uuid.UUID(tenant),
                    "rid": role_id,
                    "rname": "ops_custom",
                    "stale": ["erp.finance.read"],
                },
            )
            await session.commit()

        await sync_rbac_from_identity()

        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT permissions FROM core_roles "
                        "WHERE tenant_id = :tid AND name = :rname"
                    ),
                    {"tid": uuid.UUID(tenant), "rname": "ops_custom"},
                )
            ).scalar_one()
        assert sorted(row) == ["erp.ai.invoke", "erp.finance.read"]

    async def test_revoked_permission_removed_from_core(self, tenant: str) -> None:
        from core.seed import sync_rbac_from_identity

        role_id = uuid.uuid4()
        async with async_session_factory() as session:
            await session.execute(
                text(
                    "INSERT INTO roles (id, tenant_id, name, permissions, is_system_role) "
                    "VALUES (:rid, :tid, :rname, :perms, false)"
                ),
                {
                    "rid": role_id,
                    "tid": uuid.UUID(tenant),
                    "rname": "ops_custom",
                    "perms": ["erp.finance.read"],  # erp.ai.invoke was REVOKED
                },
            )
            await session.execute(
                text(
                    "INSERT INTO core_roles (tenant_id, id, name, permissions, is_system_role) "
                    "VALUES (:tid, :rid, :rname, :stale, false)"
                ),
                {
                    "tid": uuid.UUID(tenant),
                    "rid": role_id,
                    "rname": "ops_custom",
                    "stale": ["erp.ai.invoke", "erp.finance.read"],
                },
            )
            await session.commit()

        await sync_rbac_from_identity()

        async with async_session_factory() as session:
            row = (
                await session.execute(
                    text(
                        "SELECT permissions FROM core_roles "
                        "WHERE tenant_id = :tid AND name = :rname"
                    ),
                    {"tid": uuid.UUID(tenant), "rname": "ops_custom"},
                )
            ).scalar_one()
        assert sorted(row) == ["erp.finance.read"]
