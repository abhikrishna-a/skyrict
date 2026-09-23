"""Unit tests for role-edit propagation to core's RBAC projection.

The reported bug (AI permissions 403): a custom role's permissions are edited
in identity, but core keeps enforcing the pre-edit array from its mirrored
``core_roles`` row - so newly added keys (e.g. ``erp.ai.invoke``) stay denied
at request time. These tests pin the service contract: every create/update
mirrors the role with REPLACE semantics (adds AND removals) and emits the
``identity.rbac.role_updated`` event; mirror failures never fail the edit.
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest

from identity.domain.entities import Role
from identity.features.roles.rbac_mirror import RbacRoleMirror
from identity.features.roles.schemas import RoleCreateRequest
from identity.features.roles.service import RoleManagementService
from skyrict_common.exceptions import NotFoundError, ValidationError


class FakeRoleRepo:
    """Minimal in-memory RoleRepositoryPort double."""

    def __init__(self, roles: list[Role] | None = None) -> None:
        self.roles: dict[uuid.UUID, Role] = {}
        for role in roles or []:
            if role.id is None:
                role.id = uuid.uuid4()
            self.roles[role.id] = role

    async def create(self, role: Role) -> Role:
        role.id = uuid.uuid4()
        self.roles[role.id] = role
        return role

    async def get_by_id(self, role_id: str | uuid.UUID) -> Role | None:
        return self.roles.get(uuid.UUID(str(role_id)))

    async def get_by_name(self, tenant_id: str | uuid.UUID, name: str) -> Role | None:
        for role in self.roles.values():
            if role.name == name and str(role.tenant_id) == str(tenant_id):
                return role
        return None

    async def update(self, role: Role) -> Role:
        if role.id is not None:
            self.roles[role.id] = role
        return role


class FakeMirror:
    """Records mirror_role calls; optionally raises to prove best-effort wiring."""

    def __init__(self, *, fail: bool = False) -> None:
        self.fail = fail
        self.calls: list[tuple[str, Role]] = []

    async def mirror_role(self, *, tenant_id: str | uuid.UUID, role: Role) -> None:
        if self.fail:
            raise RuntimeError("mirror down")
        self.calls.append((str(tenant_id), role))


def _make_role(
    *,
    name: str = "custom_role",
    permissions: list[str] | None = None,
    tenant_id: uuid.UUID | None = None,
) -> Role:
    return Role(
        tenant_id=tenant_id or uuid.uuid4(),
        name=name,
        permissions=permissions or [],
        is_system_role=False,
    )


@pytest.fixture
def published(monkeypatch: pytest.MonkeyPatch) -> list[dict[str, Any]]:
    """Capture every publish_event envelope (logging stub replaced)."""

    captured: list[dict[str, Any]] = []

    async def _capture(topic: str, key: str, payload: dict[str, Any]) -> None:
        captured.append(payload)

    import identity.events.producers.tenant_events as producers

    monkeypatch.setattr(producers, "publish_event", _capture)
    return captured


class TestUpdateRolePropagatesToCore:
    async def test_added_permission_is_mirrored_and_emitted(
        self, published: list[dict[str, Any]]
    ) -> None:
        """Regression: editing a role to add erp.ai.invoke must reach core."""
        tenant_id = uuid.uuid4()
        role = _make_role(name="ops", permissions=["erp.finance.read"], tenant_id=tenant_id)
        repo = FakeRoleRepo([role])
        mirror = FakeMirror()
        service = RoleManagementService(repo, rbac_mirror=mirror)

        updated = await service.update_role(
            tenant_id, role.id, permissions=["erp.finance.read", "erp.ai.invoke"]
        )

        assert updated.permissions == ["erp.finance.read", "erp.ai.invoke"]
        assert len(mirror.calls) == 1
        assert mirror.calls[0][1].permissions == ["erp.finance.read", "erp.ai.invoke"]
        assert any(
            payload.get("event_type") == "identity.rbac.role_updated"
            and payload["role"]["permissions"] == ["erp.finance.read", "erp.ai.invoke"]
            for payload in published
        )

    async def test_removed_permission_is_replaced_not_merged(
        self, published: list[dict[str, Any]]
    ) -> None:
        """Removal must propagate: mirror replaces the array, never unions."""
        tenant_id = uuid.uuid4()
        role = _make_role(
            name="ops",
            permissions=["erp.finance.read", "erp.ai.invoke"],
            tenant_id=tenant_id,
        )
        repo = FakeRoleRepo([role])
        mirror = FakeMirror()
        service = RoleManagementService(repo, rbac_mirror=mirror)

        await service.update_role(tenant_id, role.id, permissions=["erp.finance.read"])

        assert mirror.calls[0][1].permissions == ["erp.finance.read"]
        assert "erp.ai.invoke" not in mirror.calls[0][1].permissions

    async def test_name_only_edit_still_mirrors_current_permissions(
        self, published: list[dict[str, Any]]
    ) -> None:
        tenant_id = uuid.uuid4()
        role = _make_role(name="ops", permissions=["erp.crm.read"], tenant_id=tenant_id)
        repo = FakeRoleRepo([role])
        mirror = FakeMirror()
        service = RoleManagementService(repo, rbac_mirror=mirror)

        await service.update_role(tenant_id, role.id, name="super_ops")

        assert mirror.calls[0][1].name == "super_ops"
        assert mirror.calls[0][1].permissions == ["erp.crm.read"]

    async def test_mirror_failure_never_fails_the_edit(
        self, published: list[dict[str, Any]]
    ) -> None:
        tenant_id = uuid.uuid4()
        role = _make_role(name="ops", permissions=["erp.finance.read"], tenant_id=tenant_id)
        repo = FakeRoleRepo([role])
        service = RoleManagementService(repo, rbac_mirror=FakeMirror(fail=True))

        updated = await service.update_role(tenant_id, role.id, permissions=["erp.ai.invoke"])

        assert updated.permissions == ["erp.ai.invoke"]
        # The durable event is still emitted even when the live bridge fails.
        assert any(
            payload.get("event_type") == "identity.rbac.role_updated"
            and payload["role"]["permissions"] == ["erp.ai.invoke"]
            for payload in published
        )


class TestCreateRolePropagatesToCore:
    async def test_create_mirrors_and_emits(self, published: list[dict[str, Any]]) -> None:
        repo = FakeRoleRepo()
        mirror = FakeMirror()
        service = RoleManagementService(repo, rbac_mirror=mirror)

        role = await service.create_custom_role(
            uuid.uuid4(), RoleCreateRequest(name="ops", permission_keys=["erp.crm.read"])
        )

        assert role.is_system_role is False
        assert len(mirror.calls) == 1
        assert mirror.calls[0][1].permissions == ["erp.crm.read"]
        assert any(
            payload.get("event_type") == "identity.rbac.role_updated"
            and payload["role"]["role_name"] == "ops"
            and payload["role"]["is_system_role"] is False
            for payload in published
        )


class TestGuardrailsStillHold:
    async def test_system_role_edit_still_rejected(self, published: list[dict[str, Any]]) -> None:
        tenant_id = uuid.uuid4()
        role = Role(
            tenant_id=tenant_id,
            name="tenant_owner",
            permissions=["*"],
            is_system_role=True,
        )
        repo = FakeRoleRepo([role])
        service = RoleManagementService(repo, rbac_mirror=FakeMirror())

        with pytest.raises(ValidationError, match="System roles"):
            await service.update_role(tenant_id, role.id, permissions=["erp.crm.read"])
        assert published == []

    async def test_cross_tenant_edit_still_rejected(self, published: list[dict[str, Any]]) -> None:
        role = _make_role(name="ops", permissions=["erp.crm.read"])
        repo = FakeRoleRepo([role])
        service = RoleManagementService(repo, rbac_mirror=FakeMirror())

        with pytest.raises(NotFoundError):
            await service.update_role(uuid.uuid4(), role.id, permissions=["erp.ai.invoke"])
        assert published == []


class TestRbacRoleMirrorSql:
    """Axiomatic guard: the SQL bridge constants must not regress to merging."""

    def test_replace_semantics_present(self) -> None:
        import inspect

        source = inspect.getsource(RbacRoleMirror.mirror_role)
        assert "EXCLUDED.permissions" in source
        assert "core_roles.permissions ||" not in source
