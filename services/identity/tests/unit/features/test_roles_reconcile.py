"""Unit tests for role permission resolution and system-role reconciliation.

Covers two pure helpers that carry the production fixes for owner permission
drift:

* ``repository._effective_permissions`` - the owner invariant (any
  ``tenant_owner`` holder resolves to full access regardless of the stored
  array), keeping "owner lost permissions" structurally impossible.
* ``reconcile.plan_system_role_changes`` - the diff used to realign system
  roles with the platform definitions without ever touching custom roles.
"""

from __future__ import annotations

from identity.core.constants import TENANT_OWNER_ROLE
from identity.core.permissions import WILDCARD
from identity.features.roles.reconcile import plan_system_role_changes
from identity.features.roles.repository import _effective_permissions


class TestEffectivePermissions:
    async def test_owner_resolves_to_full_access_when_wildcard_drifted(self) -> None:
        rows = [(TENANT_OWNER_ROLE, ["invitations:send"])]
        assert _effective_permissions(rows) == {WILDCARD}

    async def test_owner_takes_precedence_over_other_granted_roles(self) -> None:
        rows = [
            ("standard_user", ["users:read", "settings:read"]),
            (TENANT_OWNER_ROLE, [WILDCARD, "invitations:send"]),
        ]
        assert _effective_permissions(rows) == {WILDCARD}

    async def test_non_owner_unions_all_granted_arrays(self) -> None:
        rows = [
            ("standard_user", ["users:read"]),
            ("auditor", ["erp.payroll.read", "audit:read"]),
        ]
        assert _effective_permissions(rows) == {
            "users:read",
            "erp.payroll.read",
            "audit:read",
        }

    async def test_empty_grant_set_resolves_to_empty(self) -> None:
        assert _effective_permissions([]) == set()


class TestPlanSystemRoleChanges:
    async def test_healthy_tenant_needs_no_changes(self) -> None:
        definitions = {
            "tenant_owner": (WILDCARD, "invitations:send"),
            "standard_user": ("users:read",),
        }
        existing = {
            "tenant_owner": [WILDCARD, "invitations:send"],
            "standard_user": ["users:read"],
        }
        to_create, to_repair = plan_system_role_changes(existing, definitions=definitions)
        assert to_create == []
        assert to_repair == []

    async def test_drifted_owner_is_flagged_for_repair(self) -> None:
        definitions = {
            "tenant_owner": (WILDCARD, "invitations:send"),
        }
        existing = {
            "tenant_owner": ["invitations:send"],
        }
        to_create, to_repair = plan_system_role_changes(existing, definitions=definitions)
        assert to_create == []
        assert to_repair == ["tenant_owner"]

    async def test_missing_system_role_is_flagged_for_creation(self) -> None:
        definitions = {
            "tenant_owner": (WILDCARD, "invitations:send"),
            "auditor": ("audit:read",),
        }
        existing = {"tenant_owner": [WILDCARD, "invitations:send"]}
        to_create, to_repair = plan_system_role_changes(existing, definitions=definitions)
        assert to_create == ["auditor"]
        assert to_repair == []

    async def test_order_insensitive_arrays_are_not_a_diff(self) -> None:
        definitions = {"auditor": ("audit:read", "sessions:read")}
        existing = {"auditor": ["sessions:read", "audit:read"]}
        to_create, to_repair = plan_system_role_changes(existing, definitions=definitions)
        assert to_create == []
        assert to_repair == []

    async def test_custom_role_names_are_ignored_when_not_in_definitions(self) -> None:
        definitions = {"tenant_owner": (WILDCARD, "invitations:send")}
        existing = {
            "tenant_owner": [WILDCARD, "invitations:send"],
            "finance_viewer": ["erp.finance.read"],
        }
        to_create, to_repair = plan_system_role_changes(existing, definitions=definitions)
        assert to_create == []
        assert to_repair == []
