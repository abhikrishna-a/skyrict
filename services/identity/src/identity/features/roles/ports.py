"""Role repository port - the persistence contract role management depends on.

Ports abstract persistence only (never business rules). Methods accept and
return domain entities; SQLAlchemy lives in the concrete implementation
``identity.features.roles.repository``.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from identity.domain.entities import Role, ScopeType

if TYPE_CHECKING:
    import uuid


class RoleRepositoryPort(Protocol):
    """Persistence operations for roles and role grants."""

    async def create(self, role: Role) -> Role: ...

    async def get_by_id(self, role_id: str | uuid.UUID) -> Role | None: ...

    async def get_by_name(self, tenant_id: str | uuid.UUID, name: str) -> Role | None: ...

    async def list_by_tenant(
        self, tenant_id: str | uuid.UUID, *, offset: int = 0, limit: int = 20
    ) -> list[Role]: ...

    async def grant_to_user(
        self,
        *,
        user_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        tenant_id: str | uuid.UUID,
        scope_id: str | uuid.UUID,
        scope_type: ScopeType = ScopeType.TENANT,
    ) -> None: ...

    async def get_roles_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> list[str]: ...

    async def update(self, role: Role) -> Role: ...

    async def delete(self, role_id: str | uuid.UUID) -> None: ...

    async def grant_exists(
        self,
        user_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        scope_type: ScopeType,
        scope_id: str | uuid.UUID,
    ) -> bool: ...

    async def get_permissions_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> set[str]: ...

    async def revoke_all_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> None: ...

    async def count_users_with_role(self, tenant_id: str | uuid.UUID, role_name: str) -> int: ...


class RbacRoleMirrorPort(Protocol):
    """Best-effort Phase-1 bridge keeping core's ``core_roles`` projection current.

    Identity owns role definitions; the core service enforces ERP grants from
    its mirrored ``core_roles`` / ``core_user_roles`` tables. This port lets
    the roles feature publish role-definition changes (create/edit) to that
    mirror so added AND removed permissions take effect at request time - not
    only on the next grant, invite accept, or core boot.
    """

    async def mirror_role(self, *, tenant_id: str | uuid.UUID, role: Role) -> None: ...
