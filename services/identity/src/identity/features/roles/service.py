"""Role management service - custom role CRUD business rules.

``AuthorizationService`` resolves a user's roles to permissions and enforces
permission checks (fail-closed). ``RoleManagementService`` owns role-creation,
update, deletion, and assignment rules and persists through the
``RoleRepositoryPort``.
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

import structlog

from identity.core.constants import SYSTEM_ROLE_NAMES
from identity.core.permissions import CATALOG, WILDCARD
from identity.domain.entities import Role, ScopeType
from identity.events.producers.tenant_events import (
    emit_rbac_role_granted,
    emit_rbac_role_updated,
)
from skyrict_common.exceptions import (
    AuthorizationError,
    NotFoundError,
    PermissionDeniedError,
    ValidationError,
)

if TYPE_CHECKING:
    from identity.features.roles.ports import RbacRoleMirrorPort, RoleRepositoryPort
    from identity.features.roles.schemas import RoleCreateRequest

logger = structlog.get_logger("identity.roles.service")


class AuthorizationService:
    """Handles permission checks and RBAC enforcement."""

    def __init__(self, role_repo: RoleRepositoryPort) -> None:
        self.role_repo = role_repo

    async def check_permission(
        self,
        *,
        user_is_active: bool,
        user_id: str | uuid.UUID,
        permission: str,
        tenant_id: str | uuid.UUID,
    ) -> bool:
        """Check whether an active user has a specific permission in their tenant.

        Resolves the user's roles to permissions through the role repository and
        fails closed: an empty permission set (no roles), an unknown permission,
        or a resolution error never opens access.

        Returns True when authorized; raises otherwise.
        """
        if not user_is_active:
            raise AuthorizationError("User account is disabled")

        permissions = await self.role_repo.get_permissions_for_user(user_id, tenant_id)

        if WILDCARD in permissions or permission in permissions:
            return True

        raise PermissionDeniedError(f"Missing required permission: {permission}")

    async def require_permission(
        self,
        *,
        user_is_active: bool,
        user_id: str | uuid.UUID,
        permission: str,
        tenant_id: str | uuid.UUID,
    ) -> None:
        """Like check_permission but always raises on failure."""
        await self.check_permission(
            user_is_active=user_is_active,
            user_id=user_id,
            permission=permission,
            tenant_id=tenant_id,
        )


class RoleManagementService:
    """Encapsulates custom-role creation, management, and assignment rules."""

    def __init__(
        self,
        role_repo: RoleRepositoryPort,
        rbac_mirror: RbacRoleMirrorPort | None = None,
    ) -> None:
        self.role_repo = role_repo
        self.rbac_mirror = rbac_mirror

    async def _mirror_role_change(self, role: Role) -> None:
        """Propagate a role-definition change to core's RBAC projection.

        Best-effort: the synchronous mirror is logged, never raised (a stale
        projection must not fail the edit - the future event consumer or
        ``core provision-rbac`` heals it). The ``identity.rbac.role_updated``
        event is always emitted for the durable bus path.
        """
        if self.rbac_mirror is not None and role.id is not None:
            try:
                await self.rbac_mirror.mirror_role(tenant_id=role.tenant_id, role=role)
            except Exception:
                logger.exception(
                    "rbac_mirror.failed",
                    tenant_id=str(role.tenant_id),
                    role=role.name,
                )
        if role.id is not None:
            await emit_rbac_role_updated(
                tenant_id=role.tenant_id,
                role_id=role.id,
                role_name=role.name,
                permissions=list(role.permissions),
                is_system_role=role.is_system_role,
            )

    async def create_custom_role(self, tenant_id: str | uuid.UUID, body: RoleCreateRequest) -> Role:
        """Create a custom role, rejecting reserved system names and duplicates."""
        if body.name in SYSTEM_ROLE_NAMES:
            raise ValidationError(f"'{body.name}' is a reserved system role")

        existing = await self.role_repo.get_by_name(tenant_id, body.name)
        if existing is not None:
            raise ValidationError(f"Role '{body.name}' already exists")

        self._validate_permissions(body.permission_keys)

        role = await self.role_repo.create(
            Role(
                tenant_id=uuid.UUID(str(tenant_id)),
                name=body.name,
                permissions=body.permission_keys,
                is_system_role=False,
            )
        )
        await self._mirror_role_change(role)
        return role

    async def list_roles(
        self, tenant_id: str | uuid.UUID, *, offset: int = 0, limit: int = 20
    ) -> list[Role]:
        """List all roles (system + custom) for a tenant."""
        return await self.role_repo.list_by_tenant(tenant_id, offset=offset, limit=limit)

    async def get_role(self, tenant_id: str | uuid.UUID, role_id: str | uuid.UUID) -> Role:
        """Fetch a single role within the routed tenant (404 when absent/foreign)."""
        return await self._require_owned_role(tenant_id, role_id)

    async def update_role(
        self,
        tenant_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        *,
        name: str | None = None,
        permissions: list[str] | None = None,
    ) -> Role:
        """Update a custom role's name and/or permissions (tenant-owned only).

        System roles are immutable: their definitions are platform-owned and
        kept aligned by reconciliation, not by tenant edits. Guarding here
        closes the drift entry-point in the API (the UI already locks them).
        """
        if name is None and permissions is None:
            raise ValidationError("Nothing to update")

        role = await self._require_owned_role(tenant_id, role_id)

        if role.is_system_role:
            raise ValidationError("System roles are built in and cannot be changed")

        if name is not None:
            if name in SYSTEM_ROLE_NAMES:
                raise ValidationError(f"'{name}' is a reserved system role")
            existing = await self.role_repo.get_by_name(tenant_id, name)
            if existing is not None and existing.id != role.id:
                raise ValidationError(f"Role '{name}' already exists")
            role.name = name

        if permissions is not None:
            self._validate_permissions(permissions)
            role.permissions = permissions

        updated = await self.role_repo.update(role)
        await self._mirror_role_change(updated)
        return updated

    async def delete_role(self, tenant_id: str | uuid.UUID, role_id: str | uuid.UUID) -> None:
        """Delete a custom role; system roles are protected from deletion."""
        role = await self._require_owned_role(tenant_id, role_id)
        if role.is_system_role:
            raise ValidationError("System roles cannot be deleted")
        await self.role_repo.delete(role_id)

    async def assign_role(
        self,
        tenant_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        *,
        user_id: str | uuid.UUID,
        scope_type: ScopeType = ScopeType.TENANT,
        scope_id: str | uuid.UUID | None = None,
    ) -> None:
        """Grant a role to a user within a scope (idempotent)."""
        role = await self._require_owned_role(tenant_id, role_id)
        role_uuid = role.id
        if role_uuid is None:
            raise NotFoundError("Role not found")

        resolved_scope_id: str | uuid.UUID
        if scope_type == ScopeType.TENANT:
            resolved_scope_id = tenant_id
        else:
            if scope_id is None:
                raise ValidationError("scope_id is required for non-tenant scopes")
            resolved_scope_id = scope_id

        if await self.role_repo.grant_exists(user_id, role_uuid, scope_type, resolved_scope_id):
            return

        await self.role_repo.grant_to_user(
            user_id=user_id,
            role_id=role_uuid,
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=resolved_scope_id,
        )

        await emit_rbac_role_granted(
            tenant_id=tenant_id,
            user_id=user_id,
            role_id=role_uuid,
            role_name=role.name,
            permissions=role.permissions,
            is_system_role=role.is_system_role,
            scope_id=resolved_scope_id,
        )

    async def _require_owned_role(
        self, tenant_id: str | uuid.UUID, role_id: str | uuid.UUID
    ) -> Role:
        """Fetch a role and enforce tenant ownership (404 when absent/foreign)."""
        role = await self.role_repo.get_by_id(role_id)
        if role is None or role.tenant_id != uuid.UUID(str(tenant_id)):
            raise NotFoundError("Role not found")
        return role

    @staticmethod
    def _validate_permissions(permissions: list[str]) -> None:
        """Reject permission keys that are not part of the platform catalog."""
        unknown = [permission for permission in permissions if permission not in CATALOG]
        if unknown:
            raise ValidationError(f"Unknown permission(s): {', '.join(unknown)}")
