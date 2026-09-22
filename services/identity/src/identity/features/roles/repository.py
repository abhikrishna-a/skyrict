"""Role repository - DB operations for the roles and user_roles tables.

All SQLAlchemy stays in this file. Service-facing methods accept and return
domain entities (``identity.domain.entities.Role``).
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from typing import Any

from sqlalchemy import delete, func, select

from identity.core.constants import SYSTEM_ROLE_DEFINITIONS, TENANT_OWNER_ROLE
from identity.core.permissions import WILDCARD
from identity.db.repository import SqlRepository
from identity.domain.entities import Role, ScopeType
from identity.features.roles.reconcile import plan_system_role_changes
from identity.models.role import RoleModel
from identity.models.user_role import UserRoleModel
from skyrict_common.exceptions import NotFoundError


def _to_orm(role: Role) -> RoleModel:
    """Map a domain entity to a new ORM model (id is DB-generated unless set)."""
    model_kwargs: dict[str, Any] = {
        "tenant_id": role.tenant_id,
        "name": role.name,
        "permissions": role.permissions,
        "is_system_role": role.is_system_role,
    }
    if role.id is not None:
        model_kwargs["id"] = role.id
    return RoleModel(**model_kwargs)


def _from_orm(model: RoleModel) -> Role:
    """Map an ORM model to a domain entity."""
    return Role(
        id=model.id,
        tenant_id=model.tenant_id,
        name=model.name,
        permissions=list(model.permissions),
        is_system_role=model.is_system_role,
        created_at=model.created_at,
    )


def _effective_permissions(
    rows: Sequence[tuple[str, Sequence[str]]],
) -> set[str]:
    """Resolve granted role rows to an effective permission set.

    ``tenant_owner`` holders resolve to full access regardless of the stored
    array. The owner role is provisioned with the ``*`` wildcard and must never
    be narrowed; taking precedence at resolution time makes "owner lost
    permissions" structurally impossible even if a stored array drifted.

    Rows are ``(role_name, permissions_array)`` pairs. Pure and database-free
    so the invariant is unit-testable without a database.
    """
    permissions: set[str] = set()
    for role_name, role_permissions in rows:
        if role_name == TENANT_OWNER_ROLE:
            return {WILDCARD}
        permissions.update(role_permissions)
    return permissions


class RoleRepository(SqlRepository):
    """Repository for role persistence (implements ``RoleRepositoryPort``)."""

    async def create(self, role: Role) -> Role:
        """Persist a new role and return it with its DB-generated id."""
        model = _to_orm(role)
        self.session.add(model)
        await self.session.flush()
        await self.session.refresh(model)
        return _from_orm(model)

    async def get_by_id(self, role_id: str | uuid.UUID) -> Role | None:
        """Fetch a role by primary key, or None when absent."""
        model = await self.session.get(RoleModel, role_id)
        return _from_orm(model) if model is not None else None

    async def get_by_name(self, tenant_id: str | uuid.UUID, name: str) -> Role | None:
        """Fetch a role by name within a tenant."""
        stmt = select(RoleModel).where(
            RoleModel.tenant_id == tenant_id,
            RoleModel.name == name,
        )
        result = await self.session.execute(stmt)
        model = result.scalar_one_or_none()
        return _from_orm(model) if model is not None else None

    async def list_by_tenant(
        self, tenant_id: str | uuid.UUID, *, offset: int = 0, limit: int = 20
    ) -> list[Role]:
        """List all roles for a tenant, ordered by name."""
        stmt = (
            select(RoleModel)
            .where(RoleModel.tenant_id == tenant_id)
            .order_by(RoleModel.name.asc())
            .offset(offset)
            .limit(limit)
        )
        result = await self.session.execute(stmt)
        return [_from_orm(model) for model in result.scalars().all()]

    async def grant_to_user(
        self,
        *,
        user_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        tenant_id: str | uuid.UUID,
        scope_id: str | uuid.UUID,
        scope_type: ScopeType = ScopeType.TENANT,
    ) -> None:
        """Grant a role to a user within a scope (flush only)."""
        grant = UserRoleModel(
            user_id=user_id,
            role_id=role_id,
            tenant_id=tenant_id,
            scope_type=scope_type,
            scope_id=scope_id,
        )
        self.session.add(grant)
        await self.session.flush()

    async def get_roles_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> list[str]:
        """Return the names of all roles granted to a user in a tenant."""
        stmt = (
            select(RoleModel.name)
            .join(UserRoleModel, UserRoleModel.role_id == RoleModel.id)
            .where(
                UserRoleModel.user_id == user_id,
                UserRoleModel.tenant_id == tenant_id,
            )
            .order_by(RoleModel.name.asc())
        )
        result = await self.session.execute(stmt)
        return list(result.scalars().all())

    async def update(self, role: Role) -> Role:
        """Persist mutations to an existing role and return the refreshed entity."""
        if role.id is None:
            raise NotFoundError("Role not found")
        model = await self.session.get(RoleModel, role.id)
        if model is None:
            raise NotFoundError("Role not found")
        model.name = role.name
        model.permissions = role.permissions
        model.is_system_role = role.is_system_role
        await self.session.flush()
        await self.session.refresh(model)
        return _from_orm(model)

    async def delete(self, role_id: str | uuid.UUID) -> None:
        """Delete a role by primary key.

        ``user_roles`` grants are removed explicitly first: the ORM relationship
        has no ``cascade``/``passive_deletes`` wiring, so ``session.delete(role)``
        would otherwise try to null out ``user_roles.role_id`` (NOT NULL) and
        fail. The DB-level ON DELETE CASCADE covers the same rows as a backstop.
        """
        model = await self.session.get(RoleModel, role_id)
        if model is not None:
            await self.session.execute(
                delete(UserRoleModel).where(UserRoleModel.role_id == role_id)
            )
            await self.session.delete(model)
            await self.session.flush()

    async def grant_exists(
        self,
        user_id: str | uuid.UUID,
        role_id: str | uuid.UUID,
        scope_type: ScopeType,
        scope_id: str | uuid.UUID,
    ) -> bool:
        """Return True when the exact grant already exists (idempotency probe)."""
        stmt = select(UserRoleModel).where(
            UserRoleModel.user_id == user_id,
            UserRoleModel.role_id == role_id,
            UserRoleModel.scope_type == scope_type,
            UserRoleModel.scope_id == scope_id,
        )
        result = await self.session.execute(stmt)
        return result.scalar_one_or_none() is not None

    async def get_permissions_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> set[str]:
        """Return the union of permission keys granted to a user in a tenant.

        The owner is invariant: anyone holding the ``tenant_owner`` role
        resolves to full access (``*``) even if the stored role array was ever
        drifted or trimmed, so an owner can never silently lose permissions.
        """
        stmt = (
            select(RoleModel.name, RoleModel.permissions)
            .join(UserRoleModel, UserRoleModel.role_id == RoleModel.id)
            .where(
                UserRoleModel.user_id == user_id,
                UserRoleModel.tenant_id == tenant_id,
            )
        )
        result = await self.session.execute(stmt)
        rows = [(row[0], row[1]) for row in result.all()]
        return _effective_permissions(rows)

    async def reconcile_system_roles(self) -> dict[str, int]:
        """Align every tenant's system roles with the platform definitions.

        Only ``is_system_role = TRUE`` rows are considered, so tenant-created
        custom roles are never modified. Tenants are discovered from existing
        system-role rows; a tenant with none is skipped. Safe to run on every
        boot - a healthy database is a read-only no-op.

        Returns ``{"tenants": ..., "created": ..., "repaired": ...}`` so the
        caller can log (or alarm on) what changed.
        """
        definitions = dict(SYSTEM_ROLE_DEFINITIONS)

        tenant_result = await self.session.execute(
            select(RoleModel.tenant_id).where(RoleModel.is_system_role.is_(True)).distinct()
        )
        tenant_ids = [row[0] for row in tenant_result.all()]

        created = 0
        repaired = 0

        for tenant_id in tenant_ids:
            roles_result = await self.session.execute(
                select(RoleModel).where(
                    RoleModel.tenant_id == tenant_id,
                    RoleModel.is_system_role.is_(True),
                )
            )
            existing = {role.name: role for role in roles_result.scalars().all()}

            to_create, to_repair = plan_system_role_changes(
                {name: role.permissions for name, role in existing.items()},
                definitions=definitions,
            )

            for name in to_create:
                self.session.add(
                    RoleModel(
                        tenant_id=tenant_id,
                        name=name,
                        permissions=list(definitions[name]),
                        is_system_role=True,
                    )
                )
                created += 1

            for name in to_repair:
                existing[name].permissions = list(definitions[name])
                repaired += 1

        await self.session.commit()
        return {"tenants": len(tenant_ids), "created": created, "repaired": repaired}

    async def revoke_all_for_user(
        self, user_id: str | uuid.UUID, tenant_id: str | uuid.UUID
    ) -> None:
        """Remove every role grant a user holds in a tenant (role replacement)."""
        await self.session.execute(
            delete(UserRoleModel).where(
                UserRoleModel.user_id == user_id,
                UserRoleModel.tenant_id == tenant_id,
            )
        )
        await self.session.flush()

    async def count_users_with_role(self, tenant_id: str | uuid.UUID, role_name: str) -> int:
        """Count distinct users currently granted a role in a tenant."""
        stmt = (
            select(func.count(func.distinct(UserRoleModel.user_id)))
            .join(RoleModel, UserRoleModel.role_id == RoleModel.id)
            .where(
                RoleModel.tenant_id == tenant_id,
                RoleModel.name == role_name,
            )
        )
        result = await self.session.execute(stmt)
        return int(result.scalar_one() or 0)
