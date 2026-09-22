"""System-role reconciliation - the pure diff for aligning stored roles.

Drift cause (see migration 0033 for the full story): the roles API previously
allowed permission edits on any role, and the permission validator rejects keys
outside the platform catalog (including the ``*`` wildcard). Any save to a
system role either failed (when ``*`` was kept) or silently trimmed the
wildcard (when it was dropped). No job repaired the damage, so a tenant whose
owner role lost ``*`` kept a limited owner forever while the UI showed the
owner as "only a few permissions selected".

This module holds the pure, database-free part of the repair: given a tenant's
existing *system* roles, decide which platform system roles are missing
(to create) and which permission arrays differ from the definition (to
repair). Custom roles are out of scope and never touched. The DB execution
lives on ``RoleRepository.reconcile_system_roles`` (the repository owns the
database layer); the service lifespan runs it once per boot, which also
propagates new keys added to a definition to existing tenants.

The permission-resolution invariant (``RoleRepository.get_permissions_for_user``
treats any ``tenant_owner`` holder as full access) means correctness does not
depend on this maintenance step; reconcile exists to keep stored data honest.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence

from identity.core.constants import SYSTEM_ROLE_DEFINITIONS

_DEFINITIONS: Mapping[str, Sequence[str]] = dict(SYSTEM_ROLE_DEFINITIONS)

SystemRolePlan = tuple[list[str], list[str]]


def plan_system_role_changes(
    existing: Mapping[str, Sequence[str]],
    *,
    definitions: Mapping[str, Sequence[str]] | None = None,
) -> SystemRolePlan:
    """Diff a tenant's system roles against the platform definitions.

    Returns the role names to create (missing entirely) and to repair
    (permission arrays differ from the definition). Set comparison is
    order-insensitive, matching how permission resolution unions arrays.
    Custom roles are out of scope - callers pass only system roles in.
    """
    if definitions is None:
        definitions = _DEFINITIONS

    to_create = [name for name in definitions if name not in existing]
    to_repair = [
        name
        for name, permissions in definitions.items()
        if name in existing and set(existing[name]) != set(permissions)
    ]
    return to_create, to_repair
